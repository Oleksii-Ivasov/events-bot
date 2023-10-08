import { Context, Scenes } from 'telegraf';
import { UserForm } from './userForm.interface';

export interface MySceneContext extends Context {
  session: {
    previousScene:string;
    userMatchDetails: {
      needToUploadNewProfiles: boolean,
      userMatchForms: UserForm[],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pipeline: any[],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noLocationPipeline: any[],
      currentUserIndex: number
    }
    eventDetails: {eventId: number, lookingFor: string}
    __scenes: { current: string; state: object; expires: number };
    userForm: UserForm;
  };
  scene: Scenes.SceneContextScene<MySceneContext>;
}
