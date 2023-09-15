import { Context, Scenes } from 'telegraf';
import { UserForm } from './userForm.interface';

export interface MySceneContext extends Context {
  session: {
    __scenes: { current: string; state: object; expires: number };
    userForm: UserForm;
  };
  scene: Scenes.SceneContextScene<MySceneContext>;
}
