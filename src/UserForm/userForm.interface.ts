
export interface UserForm  {
    username: string,
    gender: 'male' | 'female',
    age: number,
    location: {
        longitude: number,
        latitude: number
    } | string,
    photoId: string
}