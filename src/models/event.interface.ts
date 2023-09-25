export interface Event  {
    userId: number,
    eventId: number,
    eventName: string,
    date: string,
    about: string | undefined,
    lookingFor: string,
    location: string,
    mediaIds?: {
        type: string;
        id: string;
      }[];
    //ageRange: string
}