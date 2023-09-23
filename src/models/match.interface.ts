export interface Match {
  senderId: number;
  receiverId: number;
  senderMentionMessage: string;
  eventId?: number;
  isUserEvent?: boolean;
}
