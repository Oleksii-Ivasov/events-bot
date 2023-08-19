import { Scenes, Telegraf } from 'telegraf';
import { SceneGenerator } from './src/scenes/scenes';
import { MySceneContext } from './src/context/context.interface';
import LocalSession from 'telegraf-session-local';
import { IConfigService } from './src/config/config.interface';
import { ConfigService } from './src/config/config.service';
class Bot {
  bot: Telegraf<MySceneContext>;
  sceneGenerator = new SceneGenerator();
  stage = new Scenes.Stage<MySceneContext>(
    [
      this.sceneGenerator.nameScene(),
      this.sceneGenerator.ageScene(),
      this.sceneGenerator.genderScene(),
      this.sceneGenerator.locationScene(),
      this.sceneGenerator.photoScene(),
      this.sceneGenerator.userFormScene()
    ],
    {
      ttl: 10,
    }
  );
  constructor(private readonly configService: IConfigService) {
    this.bot = new Telegraf(this.configService.get('TOKEN'));
    this.bot.use(new LocalSession({ database: 'sessions.json' }).middleware());
    this.bot.use(this.stage.middleware());
    this.bot.command('start', (ctx) => ctx.scene.enter('name'));
    this.bot.on('message', (ctx) => ctx.reply('Спробуй /start'));
  }
  init() {
    this.bot.launch();
  }
}
const bot = new Bot(new ConfigService());
bot.init();
