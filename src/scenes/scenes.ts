import { Markup, Scenes } from 'telegraf';
import { MySceneContext } from '../context/context.interface';
import { UserForm } from '../UserForm/userForm.interface';

export class SceneGenerator {
  userForm: UserForm = {
    username: '',
    gender: 'male',
    age: 0,
    location: {
      longitude: NaN,
      latitude: NaN,
    },
    photoId: '',
  };

  nameScene(): Scenes.BaseScene<MySceneContext> {
    const name = new Scenes.BaseScene<MySceneContext>('name');
    name.enter(async (ctx) => {
      console.log('Entered name scene');
      await ctx.reply(`Вітаємо в ДайВинник! 👋
          
🖤 ДайВинник - телеграм-бот, який допоможе вам знайти компаньона на якусь подію, а також знайти другу половинку, друга або подругу!
              
Для того, щоб розпочати переглядати анкети, вам необхідно створити й налаштувати свій профіль.
              
За можливістю, заповніть його так, аби він максимально відображав вашу особистість - це допоможе знайти саме того, кого шукаєте!`);
      await ctx.reply('Як тебе звати?');
    });
    name.on('text', async (ctx) => {
      console.log('Received text in name scene:', ctx.message.text);
      this.userForm.username = ctx.message.text;
      if (this.userForm.username) {
        await ctx.reply(
          `Дякую, ${this.userForm.username}! Твоє ім'я було збережено.`
        );
        console.log('Moving to age scene');
        await ctx.scene.enter('age');
      }
    });
    name.on('message', async (ctx) => {
      console.log('Received non-text message in name scene');
      await ctx.reply("Давай краще ім'я");
      ctx.scene.reenter();
    });

    return name;
  }
  ageScene(): Scenes.BaseScene<MySceneContext> {
    const age = new Scenes.BaseScene<MySceneContext>('age');
    age.enter(async (ctx) => {
      console.log('Entered age scene');
      await ctx.reply('Тепер вкажи свій вік');
    });
    age.on('text', async (ctx) => {
      console.log('Received text in age scene:', ctx.message.text);
      this.userForm.age = Number(ctx.message.text);
      if (this.userForm.age && this.userForm.age > 0) {
        console.log('Moving to gender scene');
        await ctx.scene.enter('gender');
      } else if (!this.userForm.age) {
        await ctx.reply('Напиши вік цифрами');
      } else if (this.userForm.age <= 0) {
        await ctx.reply('Вік має бути більше 0');
      }
    });
    age.on('message', async (ctx) => {
      console.log('Received non-text message in age scene');
      ctx.reply('Давай краще вік');
    });
    return age;
  }
  genderScene(): Scenes.BaseScene<MySceneContext> {
    const gender = new Scenes.BaseScene<MySceneContext>('gender');
    gender.enter(async (ctx) => {
      console.log('Entered gender scene');
      await ctx.reply(
        'Ти хлопець чи дівчина?',
        Markup.inlineKeyboard([
          Markup.button.callback('Хлопець', 'male'),
          Markup.button.callback('Дівчина', 'female'),
        ])
      );
    });
    gender.action('male', async (ctx) => {
      this.userForm.gender = 'male';
      console.log('Moving to location scene');
      await ctx.scene.enter('location');
    });
    gender.action('female', async (ctx) => {
      this.userForm.gender = 'female';
      console.log('Moving to location scene');
      await ctx.scene.enter('location');
    });
    gender.on('message', async (ctx) => {
      await ctx.reply(
        'Будь-ласка, обери стать',
        Markup.inlineKeyboard([
          Markup.button.callback('Хлопець', 'male'),
          Markup.button.callback('Дівчина', 'female'),
        ])
      );
    });
    return gender;
  }
  locationScene(): Scenes.BaseScene<MySceneContext> {
    const location = new Scenes.BaseScene<MySceneContext>('location');
    location.enter(async (ctx) => {
      await ctx.reply(
        'Вкажи своє місто або дозволь визначити нам',
        Markup.keyboard([
          Markup.button.locationRequest('Моє місцезнаходження'),
        ]).resize()
      );
    });
    location.on('location', async (ctx) => {
      try {
        const { latitude, longitude } = ctx.message.location;
        this.userForm.location = { latitude, longitude };
        await ctx.reply('Зберегли твоє місцезнаходження');
        await ctx.scene.enter('photo');
      } catch (error) {
        ctx.reply('Упс... Відбулася помилка');
      }
    });
    location.on('text', async (ctx) => {
      this.userForm.location = ctx.message.text;
      await ctx.reply('Зберегли твоє місцезнаходження');
      await ctx.scene.enter('photo');
    });
    location.on('message', async (ctx) => {
      await ctx.reply('Напиши назву свого міста або відправ місцезнаходження');
    });

    return location;
  }
  photoScene(): Scenes.BaseScene<MySceneContext> {
    const photo = new Scenes.BaseScene<MySceneContext>('photo');
    photo.enter(async (ctx) => {
      console.log('Entered photo scene');
      await ctx.reply('Тепер завантаж своє фото щоб інші могли тебе побачити');
    });
    photo.on('photo', async (ctx) => {
      const photos = ctx.message.photo;
      photos.sort((a, b) => {
        const resolutionA = a.width * a.height;
        const resolutionB = b.width * b.height;
        return resolutionB - resolutionA;
      });
      this.userForm.photoId = photos[0].file_id;
      await ctx.scene.enter('userform');
    });
    photo.on('text', async (ctx) => {
      await ctx.reply('Завантаж, будь-ласка, своє фото');
    });
    photo.on('message', async (ctx) => {
      await ctx.reply('Завантаж, будь-ласка, своє фото');
    });
    return photo;
  }
  userFormScene(): Scenes.BaseScene<MySceneContext> {
    const userForm = new Scenes.BaseScene<MySceneContext>('userform');
    userForm.enter(async (ctx) => {
      await ctx.reply(`Супер! Твоя анкета має такий вигляд:
Ім'я: ${this.userForm.username}
Вік: ${this.userForm.age}
Місто:${this.userForm.location}`);
      ctx.scene.leave();
    });
    return userForm;
  }
}
