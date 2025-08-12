const express = require('express');
const { body, validationResult } = require('express-validator');
const Blog = require('../models/Blog');
const User = require('../models/User');
const { auth, editorAuth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get all blogs with filters
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      category, 
      status, 
      author, 
      featured,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    if (category) query.category = category;
    if (status) query.status = status;
    if (author) query.author = author;
    if (featured !== undefined) query.featured = featured === 'true';

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const blogs = await Blog.find(query)
      .populate('author', 'username email profile.firstName profile.lastName')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Blog.countDocuments(query);

    res.json({
      blogs,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get blog by ID or slug
router.get('/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const query = identifier.match(/^[0-9a-fA-F]{24}$/) 
      ? { _id: identifier } 
      : { slug: identifier };

    const blog = await Blog.findOne(query)
      .populate('author', 'username email profile.firstName profile.lastName profile.avatar');

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    // Increment view count
    blog.stats.views += 1;
    await blog.save();

    res.json(blog);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create blog
router.post('/', [
  editorAuth,
  body('title').notEmpty().withMessage('Title is required'),
  body('content').notEmpty().withMessage('Content is required'),
  body('excerpt').notEmpty().withMessage('Excerpt is required'),
  body('category').isIn(['Adventure', 'Culture', 'Food', 'Nature', 'City', 'Beach', 'Mountain', 'Historical']).withMessage('Invalid category')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title,
      content,
      excerpt,
      category,
      tags,
      location,
      seo,
      featuredImage,
      images,
      status = 'draft',
      featured = false,
      scheduledAt
    } = req.body;

    // Generate slug from title
    const slug = title.toLowerCase()
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);

    // Check if slug already exists
    const existingBlog = await Blog.findOne({ slug });
    if (existingBlog) {
      return res.status(400).json({ message: 'A blog with similar title already exists' });
    }

    const blog = new Blog({
      title,
      slug,
      content,
      excerpt,
      category,
      tags,
      location,
      seo,
      featuredImage,
      images,
      author: req.user._id,
      status,
      featured,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      publishedAt: status === 'published' ? new Date() : null
    });

    await blog.save();

    // Update user's post count
    await User.findByIdAndUpdate(req.user._id, { $inc: { 'stats.postsCount': 1 } });

    const populatedBlog = await Blog.findById(blog._id)
      .populate('author', 'username email profile.firstName profile.lastName');

    res.status(201).json({
      message: 'Blog created successfully',
      blog: populatedBlog
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update blog
router.put('/:id', editorAuth, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    // Check if user owns the blog or is admin
    if (blog.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to update this blog' });
    }

    const {
      title,
      content,
      excerpt,
      category,
      tags,
      location,
      seo,
      featuredImage,
      images,
      status,
      featured,
      scheduledAt
    } = req.body;

    // Update slug if title changed
    if (title && title !== blog.title) {
      const newSlug = title.toLowerCase()
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);
      
      const existingBlog = await Blog.findOne({ slug: newSlug, _id: { $ne: blog._id } });
      if (existingBlog) {
        return res.status(400).json({ message: 'A blog with similar title already exists' });
      }
      blog.slug = newSlug;
    }

    if (title) blog.title = title;
    if (content) blog.content = content;
    if (excerpt) blog.excerpt = excerpt;
    if (category) blog.category = category;
    if (tags) blog.tags = tags;
    if (location) blog.location = location;
    if (seo) blog.seo = { ...blog.seo, ...seo };
    if (featuredImage) blog.featuredImage = featuredImage;
    if (images) blog.images = images;
    if (status) {
      blog.status = status;
      if (status === 'published' && !blog.publishedAt) {
        blog.publishedAt = new Date();
      }
    }
    if (featured !== undefined) blog.featured = featured;
    if (scheduledAt) blog.scheduledAt = new Date(scheduledAt);

    await blog.save();

    const updatedBlog = await Blog.findById(blog._id)
      .populate('author', 'username email profile.firstName profile.lastName');

    res.json({
      message: 'Blog updated successfully',
      blog: updatedBlog
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete blog
router.delete('/:id', editorAuth, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    // Check if user owns the blog or is admin
    if (blog.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this blog' });
    }

    await Blog.findByIdAndDelete(req.params.id);

    // Update user's post count
    await User.findByIdAndUpdate(blog.author, { $inc: { 'stats.postsCount': -1 } });

    res.json({ message: 'Blog deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Bulk operations (Admin only)
router.post('/bulk', adminAuth, async (req, res) => {
  try {
    const { action, blogIds } = req.body;

    if (!action || !blogIds || !Array.isArray(blogIds)) {
      return res.status(400).json({ message: 'Invalid bulk operation data' });
    }

    let result;
    switch (action) {
      case 'delete':
        result = await Blog.deleteMany({ _id: { $in: blogIds } });
        break;
      case 'publish':
        result = await Blog.updateMany(
          { _id: { $in: blogIds } },
          { status: 'published', publishedAt: new Date() }
        );
        break;
      case 'draft':
        result = await Blog.updateMany(
          { _id: { $in: blogIds } },
          { status: 'draft' }
        );
        break;
      case 'feature':
        result = await Blog.updateMany(
          { _id: { $in: blogIds } },
          { featured: true }
        );
        break;
      case 'unfeature':
        result = await Blog.updateMany(
          { _id: { $in: blogIds } },
          { featured: false }
        );
        break;
      default:
        return res.status(400).json({ message: 'Invalid bulk action' });
    }

    res.json({
      message: `Bulk ${action} completed successfully`,
      modifiedCount: result.modifiedCount || result.deletedCount
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get blog statistics
router.get('/stats/overview', editorAuth, async (req, res) => {
  try {
    const totalBlogs = await Blog.countDocuments();
    const publishedBlogs = await Blog.countDocuments({ status: 'published' });
    const draftBlogs = await Blog.countDocuments({ status: 'draft' });
    const featuredBlogs = await Blog.countDocuments({ featured: true });

    const categoryStats = await Blog.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const topBlogs = await Blog.find({ status: 'published' })
      .select('title slug stats.views stats.likes createdAt')
      .sort({ 'stats.views': -1 })
      .limit(5);

    const recentBlogs = await Blog.find()
      .select('title slug status createdAt author')
      .populate('author', 'username')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      totalBlogs,
      publishedBlogs,
      draftBlogs,
      featuredBlogs,
      categoryStats,
      topBlogs,
      recentBlogs
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
