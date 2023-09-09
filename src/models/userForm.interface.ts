export interface UserForm {
  userId: number;
  username: string;
  gender: string,
  lookingFor: string,
  age: number;
  about?: string;
  location: string;
  actualLocation:
    | {
        longitude: number;
        latitude: number;
      }
    | string;
  photoId: string;
  likesSentCount: number,
  isActive: boolean;
  isPremium: boolean;
  premiumEndTime: Date| null;
}
