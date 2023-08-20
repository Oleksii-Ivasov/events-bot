
export interface UserForm  {
    userId: number,
    username: string,
    gender: 'male' | 'female',
    lookingFor: 'male' | 'female' | 'both'
    age: number,
    about: string | undefined
    location: {
        longitude: number,
        latitude: number
    } | string,
    photoId: string
}