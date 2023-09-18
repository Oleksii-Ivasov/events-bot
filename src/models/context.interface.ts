import { Context, Scenes } from 'telegraf';
import { UserForm } from './userForm.interface';

export interface MySceneContext extends Context {
  session: {
    eventDetails: {eventId: number, lookingFor: string}
    __scenes: { current: string; state: object; expires: number };
    userForm: UserForm;
  };
  scene: Scenes.SceneContextScene<MySceneContext>;
}
