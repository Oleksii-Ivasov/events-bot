import mongoose from 'mongoose';

const userFormSchema = new mongoose.Schema({
  userId: Number,
  username: String,
  gender: String,
  age: Number,
  about: String,
  lookingFor: mongoose.Schema.Types.Mixed,
  location: String,
  actualLocation: {
    type: mongoose.Schema.Types.Mixed,
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
  photoId: String,
  isActive: Boolean,
  subscriptionType: {
    type: String,
    enum: ['free', 'premium'],
  },
  subscriptionExpirationDate: Date,
});

export const UserFormModel = mongoose.model('UserForm', userFormSchema);
