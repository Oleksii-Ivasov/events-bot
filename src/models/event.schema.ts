import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
  userId: Number,
  eventId: Number,
  eventName: String,
  date: String,
  about: {
    type: String,
    default: undefined,
  },
  lookingForMinAge: Number,
  lookingForMaxAge: Number,
  lookingFor: String,
  location: String,
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
  //ageRange: String
});
export const EventModel = mongoose.model('Event', eventSchema);
