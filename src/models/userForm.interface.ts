export interface UserForm {
  userId: number;
  username: string;
  gender: string;
  lookingFor: string;
  lookingForMinAge: number;
  lookingForMaxAge: number;
  age: number;
  about?: {
    type: string;
    content: string;
  };
  socialLinks?: string[];
  coordinates: {
    latitude: number;
    longitude: number;
  } | null;
  location: string;
  actualLocation:
    | {
        longitude: number;
        latitude: number;
      }
    | string;
  mediaIds: {
    type: string;
    id: string;
  }[];
  likesSentCount: number;
  isActive: boolean;
  isPremium: boolean;
  premiumEndTime?: Date | undefined;
  showPremiumLabel: boolean;
  showLikesCount: boolean;
  lastActive: string;
  likesCount: number;
  dislikesCount: number;
  registrationDate: string;
  referralToken: string;
  referees: string[] | [];
}
