const express = require('express');
const Blog = require('../models/Blog');
const User = require('../models/User');
const { editorAuth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Dashboard overview analytics
router.get('/dashboard', editorAuth, async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Basic counts
    const totalBlogs = await Blog.countDocuments();
    const totalUsers = await User.countDocuments();
    const publishedBlogs = await Blog.countDocuments({ status: 'published' });
    const draftBlogs = await Blog.countDocuments({ status: 'draft' });

    // Recent activity
    const recentBlogs = await Blog.countDocuments({ 
      createdAt: { $gte: sevenDaysAgo } 
    });
    const recentUsers = await User.countDocuments({ 
      createdAt: { $gte: sevenDaysAgo } 
    });

    // Total views and engagement
    const viewsStats = await Blog.aggregate([
      { $group: { 
        _id: null, 
        totalViews: { $sum: '$stats.views' },
        totalLikes: { $sum: '$stats.likes' },
        totalShares: { $sum: '$stats.shares' }
      }}
    ]);

    // Monthly blog creation trend
    const monthlyTrend = await Blog.aggregate([
      {
        $match: { createdAt: { $gte: thirtyDaysAgo } }
      },
      {
        $group: {
          _id: { 
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Category distribution
    const categoryStats = await Blog.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Top performing blogs
    const topBlogs = await Blog.find({ status: 'published' })
      .select('title slug stats.views stats.likes createdAt author')
      .populate('author', 'username')
      .sort({ 'stats.views': -1 })
      .limit(5);

    // User role distribution
    const userRoles = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);

    res.json({
      overview: {
        totalBlogs,
        totalUsers,
        publishedBlogs,
        draftBlogs,
        recentBlogs,
        recentUsers,
        totalViews: viewsStats[0]?.totalViews || 0,
        totalLikes: viewsStats[0]?.totalLikes || 0,
        totalShares: viewsStats[0]?.totalShares || 0
      },
      trends: {
        monthlyBlogCreation: monthlyTrend,
        categoryDistribution: categoryStats,
        userRoleDistribution: userRoles
      },
      topContent: {
        topBlogs
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Content analytics
router.get('/content', editorAuth, async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const daysAgo = new Date(Date.now() - parseInt(period) * 24 * 60 * 60 * 1000);

    // Blog performance metrics
    const blogMetrics = await Blog.aggregate([
      {
        $match: { createdAt: { $gte: daysAgo } }
      },
      {
        $group: {
          _id: null,
          avgViews: { $avg: '$stats.views' },
          avgLikes: { $avg: '$stats.likes' },
          avgReadingTime: { $avg: '$readingTime' },
          totalPosts: { $sum: 1 }
        }
      }
    ]);

    // Most popular categories
    const popularCategories = await Blog.aggregate([
      {
        $match: { 
          createdAt: { $gte: daysAgo },
          status: 'published'
        }
      },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalViews: { $sum: '$stats.views' },
          avgViews: { $avg: '$stats.views' }
        }
      },
      { $sort: { totalViews: -1 } }
    ]);

    // Author performance
    const authorStats = await Blog.aggregate([
      {
        $match: { 
          createdAt: { $gte: daysAgo },
          status: 'published'
        }
      },
      {
        $group: {
          _id: '$author',
          postCount: { $sum: 1 },
          totalViews: { $sum: '$stats.views' },
          totalLikes: { $sum: '$stats.likes' },
          avgViews: { $avg: '$stats.views' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'author'
        }
      },
      {
        $unwind: '$author'
      },
      {
        $project: {
          authorName: '$author.username',
          postCount: 1,
          totalViews: 1,
          totalLikes: 1,
          avgViews: 1
        }
      },
      { $sort: { totalViews: -1 } },
      { $limit: 10 }
    ]);

    // Tag popularity
    const tagStats = await Blog.aggregate([
      {
        $match: { 
          createdAt: { $gte: daysAgo },
          status: 'published'
        }
      },
      { $unwind: '$tags' },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
          totalViews: { $sum: '$stats.views' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    res.json({
      metrics: blogMetrics[0] || {
        avgViews: 0,
        avgLikes: 0,
        avgReadingTime: 0,
        totalPosts: 0
      },
      popularCategories,
      authorPerformance: authorStats,
      popularTags: tagStats
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// User analytics (Admin only)
router.get('/users', adminAuth, async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const daysAgo = new Date(Date.now() - parseInt(period) * 24 * 60 * 60 * 1000);

    // User registration trend
    const registrationTrend = await User.aggregate([
      {
        $match: { createdAt: { $gte: daysAgo } }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // User activity
    const userActivity = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 },
          activeUsers: {
            $sum: {
              $cond: [
                { $gte: ['$lastLogin', daysAgo] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    // Most active users
    const activeUsers = await User.find({
      lastLogin: { $gte: daysAgo }
    })
    .select('username email role lastLogin stats')
    .sort({ lastLogin: -1 })
    .limit(10);

    // User engagement metrics
    const engagementMetrics = await User.aggregate([
      {
        $group: {
          _id: null,
          avgPostsPerUser: { $avg: '$stats.postsCount' },
          avgViewsPerUser: { $avg: '$stats.viewsCount' },
          totalActiveUsers: {
            $sum: {
              $cond: [
                { $eq: ['$isActive', true] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    res.json({
      registrationTrend,
      userActivity,
      activeUsers,
      engagement: engagementMetrics[0] || {
        avgPostsPerUser: 0,
        avgViewsPerUser: 0,
        totalActiveUsers: 0
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Real-time statistics
router.get('/realtime', editorAuth, async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    // Today's stats
    const todayBlogs = await Blog.countDocuments({
      createdAt: { $gte: todayStart }
    });

    const todayUsers = await User.countDocuments({
      createdAt: { $gte: todayStart }
    });

    // Yesterday's stats for comparison
    const yesterdayBlogs = await Blog.countDocuments({
      createdAt: { $gte: yesterdayStart, $lt: todayStart }
    });

    const yesterdayUsers = await User.countDocuments({
      createdAt: { $gte: yesterdayStart, $lt: todayStart }
    });

    // Recent activity (last 24 hours)
    const recentActivity = await Blog.find({
      updatedAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
    })
    .select('title status updatedAt author')
    .populate('author', 'username')
    .sort({ updatedAt: -1 })
    .limit(10);

    // Online users (logged in within last hour)
    const onlineUsers = await User.countDocuments({
      lastLogin: { $gte: new Date(now.getTime() - 60 * 60 * 1000) }
    });

    res.json({
      today: {
        blogs: todayBlogs,
        users: todayUsers,
        blogChange: todayBlogs - yesterdayBlogs,
        userChange: todayUsers - yesterdayUsers
      },
      recentActivity,
      onlineUsers,
      timestamp: now
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
