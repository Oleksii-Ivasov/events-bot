export interface Event  {
    userId: number,
    eventId: number,
    eventName: string,
    date: string,
    about: string | undefined,
    ageRange: string
}