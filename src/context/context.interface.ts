import { Context, Scenes } from "telegraf"

export interface SessionData {
    like: boolean
}
export interface IBotContext extends Context {
    session: SessionData
}

 export interface MySceneContext extends Context {
      scene: Scenes.SceneContextScene<MySceneContext>;
    }