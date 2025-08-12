const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['admin', 'editor', 'author', 'subscriber'],
    default: 'subscriber'
  },
  profile: {
    firstName: String,
    lastName: String,
    bio: String,
    avatar: String,
    socialLinks: {
      twitter: String,
      instagram: String,
      facebook: String,
      website: String
    }
  },
  stats: {
    postsCount: { type: Number, default: 0 },
    viewsCount: { type: Number, default: 0 },
    likesCount: { type: Number, default: 0 }
  },
  preferences: {
    theme: { type: String, enum: ['light', 'dark'], default: 'dark' },
    notifications: { type: Boolean, default: true },
    language: { type: String, default: 'en' }
  },
  isActive: { type: Boolean, default: true },
  lastLogin: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
