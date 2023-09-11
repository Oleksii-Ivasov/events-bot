import mongoose from 'mongoose';

const userFormSchema = new mongoose.Schema({
  userId: {
    type: Number,
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  gender: {
    type: String,
    required: true,
  },
  age: {
    type: Number,
    required: true,
  },
  about: String,
  lookingFor: {
    type: String,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  actualLocation: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    validate: {
      validator: function (
        value:
          | {
              longitude: number;
              latitude: number;
            }
          | string
      ) {
        return typeof value === 'object' || typeof value === 'string';
      },
      message: 'Location must be an object or a string',
    },
  },
  mediaIds: [
    {
      type: {
        type: String,
        required: true,
      },
      id: {
        type: String,
        required: true,
      },
      _id: false,
    },
  ],
  likesSentCount: {
    type: Number,
    required: true,
  },
  isActive: {
    type: Boolean,
    required: true,
  },
  isPremium: {
    type: Boolean,
    required: true,
  },
  premiumEndTime: { type: Date, default: null },
  lastActive: {
    type: String,
    required: true
  }
});

export const UserFormModel = mongoose.model('UserForm', userFormSchema);
