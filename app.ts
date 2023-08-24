import { Scenes, Telegraf } from 'telegraf';
import { SceneGenerator } from './src/scenes/scenes';
import { MySceneContext } from './src/models/context.interface';
import LocalSession from 'telegraf-session-local';
import { IConfigService } from './src/models/config.interface';
import { ConfigService } from './src/config/config.service';
import { MongoClient, ServerApiVersion } from 'mongodb';
import express from 'express';
const configService = new ConfigService();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const app = express();
const uri = configService.get('DB_KEY');
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
      // this.sceneGenerator.eventAgeRangeScene(),
      this.sceneGenerator.userEventListScene(),
      this.sceneGenerator.lookForMatchScene(),
      this.sceneGenerator.userFormScene(),
    ],
    {
      ttl: 2592000,
    }
  );

  constructor(private readonly configService: IConfigService) {
    this.bot = new Telegraf(this.configService.get('TOKEN'));
    this.bot.use(new LocalSession({ database: 'sessions.json' }).middleware());
    this.bot.use(this.stage.middleware());
    app.use(express.json());
    app.get('/', (req, res) => {
      res.send('Hello, this is your Express app!');
    });
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
    this.bot.command('start', async (ctx) => {
      await ctx.reply(`Вітаємо в ком'юніті Дай Винника! 👋
          
👩 Дай Винник — незвичайний бот, який наповнить твоє життя приємними моментами. Він допоможе тобі знайти компаньона на якусь подію або просто прогулянку, а також знайти другу половинку, друга або подругу!
                  
🫂 Офіційний запуск повноцінного боту планується 25 серпня. Проте ти вже можеш створити й налаштувати свій профіль. Міцно обійняли тебе`);
      await ctx.scene.enter('greeting');
    });
    const regex = /^(.+):(\d+):(.+)$/;
    this.bot.action(regex, async (ctx) => {
      const actionType = ctx.match[1];
      const initiatorUserId = ctx.match[2];
      const initiatorUsername = ctx.match[3];
      let username = ctx.from?.username;
      if (username) {
        username = '@' + username;
      }
      const userLink = `tg://user?id=${ctx.from!.id}`;
      if (actionType === 'likeEvent') {
        try {
          const mentionMessage =
            username || `[${ctx.from?.first_name}](${userLink})`;
          await ctx.telegram.sendMessage(
            initiatorUserId,
            `${mentionMessage} прийняв ваше твоє запрошення на подію. Обговори деталі...`,
            { parse_mode: 'Markdown' }
          );
          await ctx.reply(
            `${initiatorUsername}
Ти прийняв запрошення на подію 🥳. Бажаю весело провести час 👋`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error('Error sending notification:', error);
        }
      } else if (actionType === 'like') {
        try {
          const mentionMessage =
            username || `[${ctx.from?.first_name}](${userLink})`;
          await ctx.telegram.sendMessage(
            initiatorUserId,
            `${mentionMessage} Бажаю весело провести час 👋`,
            { parse_mode: 'Markdown' }
          );
          await ctx.reply(
            `${initiatorUsername}
Бажаю весело провести час 👋`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error('Error sending notification:', error);
        }
      }
    });
    this.bot.command('events', async (ctx) => {
      await ctx.scene.enter('userEvents');
    });
    this.bot.command('people', async (ctx) => {
      await ctx.scene.enter('lookForMatch');
    });
    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        `🦸‍♀️ Маєш питання або пропозиції?
      
Пиши нам сюди [Олексій](tg://user?id=546195130)`,
        { parse_mode: 'Markdown' }
      );
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
