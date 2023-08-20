import { Scenes, Telegraf } from 'telegraf';
import { SceneGenerator } from './src/scenes/scenes';
import { MySceneContext } from './src/models/context.interface';
import LocalSession from 'telegraf-session-local';
import { IConfigService } from './src/models/config.interface';
import { ConfigService } from './src/config/config.service';
import { MongoClient, ServerApiVersion } from 'mongodb';
const uri =
  'mongodb+srv://admin:jW5z6rzfvoL6SuDR@cluster0.ikklltu.mongodb.net/?retryWrites=true&w=majority';

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    await client.db('cluster0').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } finally {
    await client.close();
  }
}
run().catch(console.dir);

class Bot {
  bot: Telegraf<MySceneContext>;
  sceneGenerator = new SceneGenerator(client, this.configService);
  stage = new Scenes.Stage<MySceneContext>(
    [
      this.sceneGenerator.greetingScene(),
      this.sceneGenerator.nameScene(),
      this.sceneGenerator.ageScene(),
      this.sceneGenerator.genderScene(),
      this.sceneGenerator.lookingForScene(),
      this.sceneGenerator.AboutScene(),
      this.sceneGenerator.locationScene(),
      this.sceneGenerator.photoScene(),
      this.sceneGenerator.eventMenuScene(),
      this.sceneGenerator.eventNameScene(),
      this.sceneGenerator.eventTimeScene(),
      this.sceneGenerator.eventAboutScene(),
      this.sceneGenerator.eventAgeRangeScene(),
      this.sceneGenerator.userEventListScene(),
      this.sceneGenerator.userFormScene(),
    ],
    {
      ttl: 3600,
    }
  );

  constructor(private readonly configService: IConfigService) {
    this.bot = new Telegraf(this.configService.get('TOKEN'));
    this.bot.use(new LocalSession({ database: 'sessions.json' }).middleware());
    this.bot.use(this.stage.middleware());
    this.bot.command('start', async (ctx) => {
      await ctx.reply(`Вітаємо в ком'юніті Дай Винника! 👋
          
👩 Дай Винник — незвичайний бот, який наповнить твоє життя приємними моментами. Він допоможе тобі знайти компаньона на якусь подію або просто прогулянку, а також знайти другу половинку, друга або подругу!
                  
🫂 Офіційний запуск повноцінного боту планується 25 серпня. Проте ти вже можеш створити й налаштувати свій профіль. Міцно обійняли тебе`);
      await ctx.scene.enter('greeting');
    });
    this.bot.command('events', async (ctx) => {
      await ctx.scene.enter('userEvents');
    });
    this.bot.command('profile', async (ctx) => {
      await ctx.scene.enter('userform');
    });
    this.bot.on('message', (ctx) => ctx.reply('Спробуй /start'));
  }

  init() {
    this.bot.launch();
  }
}

const bot = new Bot(new ConfigService());

bot.init();
