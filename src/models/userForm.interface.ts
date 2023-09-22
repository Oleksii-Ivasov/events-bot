export interface UserForm {
  userId: number;
  username: string;
  gender: string;
  lookingFor: string;
  age: number;
  about?: {
    type: string,
    content: string
  }
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
  registrationDate:string
}
