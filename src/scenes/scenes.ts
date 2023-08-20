import { Markup, Scenes } from 'telegraf';
import { MySceneContext } from '../models/context.interface';
import { UserForm } from '../models/userForm.interface';
import { UserFormModel } from '../models/userForm.schema';
import { MongoClient } from 'mongodb';
import axios from 'axios';
import { IConfigService } from '../models/config.interface';
import { Event } from '../models/event.interface';
import { EventModel } from '../models/event.schema';

export class SceneGenerator {
  constructor(
    private readonly client: MongoClient,
    private configService: IConfigService
  ) {}
  API_KEY = this.configService.get('API_KEY');
  userForm: UserForm = {
    userId: NaN,
    username: '',
    gender: 'male',
    lookingFor: 'both',
    age: NaN,
    about: undefined,
    location: {
      longitude: NaN,
      latitude: NaN,
    },
    photoId: '',
  };
  event: Event = {
    userId: NaN,
    eventId: NaN,
    eventName: '',
    date: '',
    about: undefined,
    ageRange: '',
  };

  greetingScene(): Scenes.BaseScene<MySceneContext> {
    const greeting = new Scenes.BaseScene<MySceneContext>('greeting');
    greeting.enter(async (ctx) => {
      await ctx.reply('⬇️⁣', Markup.keyboard([['Створити профіль']]).resize());
    });
    greeting.hears('Створити профіль', async (ctx) => {
      ctx.scene.enter('gender');
    });
    this.addCommands(greeting);
    greeting.on('message', async (ctx) => {
      await ctx.reply(
        'Обирай дії в меню ⬇️',
        Markup.keyboard([['Створити профіль']]).resize()
      );
    });
    return greeting;
  }

  nameScene(): Scenes.BaseScene<MySceneContext> {
    const name = new Scenes.BaseScene<MySceneContext>('name');
    name.enter(async (ctx) => {
      await ctx.reply('Як до тебе звертатись?');
    });
    this.addCommands(name);
    name.on('text', async (ctx) => {
      this.userForm.userId = ctx.message.from.id;
      this.userForm.username = ctx.message.text;
      if (this.userForm.username) {
        await ctx.scene.enter('age');
      }
    });
    name.on('message', async (ctx) => {
      await ctx.reply("Давай краще ім'я");
      ctx.scene.reenter();
    });

    return name;
  }
  ageScene(): Scenes.BaseScene<MySceneContext> {
    const age = new Scenes.BaseScene<MySceneContext>('age');
    age.enter(async (ctx) => {
      await ctx.reply('Скільки тобі років?');
    });
    this.addCommands(age);
    age.on('text', async (ctx) => {
      this.userForm.age = Number(ctx.message.text);
      if (this.userForm.age && this.userForm.age > 0) {
        await ctx.scene.enter('location');
      } else if (!this.userForm.age) {
        await ctx.reply('Вкажи вік цифрами');
      } else if (this.userForm.age <= 0) {
        await ctx.reply('Вік має бути більше 0');
      }
    });
    age.on('message', async (ctx) => {
      ctx.reply('Давай краще вік');
    });
    return age;
  }
  genderScene(): Scenes.BaseScene<MySceneContext> {
    const gender = new Scenes.BaseScene<MySceneContext>('gender');
    gender.enter(async (ctx) => {
      await ctx.reply(
        'Давай створимо твою анкету. Якої ти статі?',
        Markup.keyboard([['Хлопець', 'Дівчина']]).resize()
      );
    });
    this.addCommands(gender);
    gender.hears('Хлопець', async (ctx) => {
      this.userForm.gender = 'male';
      await ctx.scene.enter('lookingFor');
    });
    gender.hears('Дівчина', async (ctx) => {
      this.userForm.gender = 'female';
      await ctx.scene.enter('lookingFor');
    });
    gender.on('message', async (ctx) => {
      await ctx.reply(
        'Будь-ласка, обери стать',
        Markup.keyboard([['Хлопець', 'Дівчина']]).resize()
      );
    });
    return gender;
  }
  lookingForScene(): Scenes.BaseScene<MySceneContext> {
    const lookingFor = new Scenes.BaseScene<MySceneContext>('lookingFor');
    lookingFor.enter(async (ctx) => {
      await ctx.reply(
        'Кого шукаєш?',
        Markup.keyboard([['Хлопці', 'Дівчата', 'Неважливо']]).resize()
      );
    });
    this.addCommands(lookingFor);
    lookingFor.hears('Хлопці', async (ctx) => {
      this.userForm.lookingFor = 'male';
      await ctx.scene.enter('name');
    });
    lookingFor.hears('Дівчата', async (ctx) => {
      this.userForm.lookingFor = 'female';
      await ctx.scene.enter('name');
    });
    lookingFor.hears('Неважливо', async (ctx) => {
      this.userForm.lookingFor = 'both';
      await ctx.scene.enter('name');
    });
    lookingFor.on('message', async (ctx) => {
      await ctx.reply('Обери хто тебе цікавить');
    });
    return lookingFor;
  }
  AboutScene(): Scenes.BaseScene<MySceneContext> {
    const about = new Scenes.BaseScene<MySceneContext>('about');
    about.enter(async (ctx) => {
      await ctx.reply(
        'Напиши пару слів про себе: що полюбляєш, кого шукаєш',
        Markup.keyboard(['Пропустити']).resize()
      );
    });
    this.addCommands(about);
    about.hears('Пропустити', async (ctx) => {
      await ctx.scene.enter('userform');
    });
    about.on('text', async (ctx) => {
      if (ctx.message.text === 'Пропустити') {
        return;
      }
      if (ctx.message.text.length > 140) {
        await ctx.reply('Занадто велике повідомлення, зроби трохи меншим');
      } else {
        this.userForm.about = ctx.message.text;
        ctx.scene.enter('userform');
      }
    });
    about.on('message', async (ctx) => {
      await ctx.reply('Будь-ласка, напиши про себе');
    });
    return about;
  }
  locationScene(): Scenes.BaseScene<MySceneContext> {
    const location = new Scenes.BaseScene<MySceneContext>('location');
    location.enter(async (ctx) => {
      await ctx.reply(
        'З якого ти міста?',
        Markup.keyboard([
          Markup.button.locationRequest('Відправити місцезнаходження'),
        ]).resize()
      );
    });
    this.addCommands(location);
    location.on('location', async (ctx) => {
      try {
        const { latitude, longitude } = ctx.message.location;
        this.userForm.location = await this.getUserCityFromCoordinates(
          latitude,
          longitude
        );
        await ctx.scene.enter('photo');
      } catch (error) {
        ctx.reply('Упс... Відбулася помилка');
      }
    });
    location.on('text', async (ctx) => {
      this.userForm.location = ctx.message.text;
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
      await ctx.reply(
        'Обери свої найкращі фото або відео, які будуть бачити інші'
      );
    });
    this.addCommands(photo);
    photo.on('photo', async (ctx) => {
      const photos = ctx.message.photo;
      photos.sort((a, b) => {
        const resolutionA = a.width * a.height;
        const resolutionB = b.width * b.height;
        return resolutionB - resolutionA;
      });
      this.userForm.photoId = photos[0].file_id;
      await this.saveUserFormToDatabase(this.userForm);
      await ctx.scene.enter('about');
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
    const userFormScene = new Scenes.BaseScene<MySceneContext>('userform');
    userFormScene.enter(async (ctx) => {
      const userId = ctx.message?.from.id;
      if (userId) {
        const userForm = await this.getUserFormDataFromDatabase(userId);
        if (userForm) {
          let caption = '';
          if (userForm.about) {
            caption = `Супер! Так виглядає твій профіль:
Ім'я: ${userForm.username}
Вік: ${userForm.age}
Місто: ${userForm.location}
Про себе: ${userForm.about}`;
          } else {
            caption = `Супер! Так виглядає твій профіль:
Ім'я: ${userForm.username}
Вік: ${userForm.age}
Місто: ${userForm.location}`;
          }
          await ctx.replyWithPhoto(userForm.photoId, { caption });
          await ctx.scene.enter('eventMenu');
        } else {
          await ctx.reply('В тебе ще немає профілю');
          await ctx.scene.enter('greeting');
        }
      }
    });
    this.addCommands(userFormScene);
    return userFormScene;
  }
  eventMenuScene(): Scenes.BaseScene<MySceneContext> {
    const eventMenu = new Scenes.BaseScene<MySceneContext>('eventMenu');
    eventMenu.enter(async (ctx) => {
      ctx.reply(
        `Чудово ) Тепер ти можеш ознайомитися з 
переліком подій або додати свою`,
        Markup.inlineKeyboard([
          Markup.button.callback('Додати подію', 'addEvent'),
          Markup.button.callback('Переглянути спосок подій', 'viewEvent'),
        ])
      );
    });
    this.addCommands(eventMenu);
    eventMenu.action('addEvent', async (ctx) => {
      await ctx.scene.enter('eventName');
    });
    eventMenu.on('message', async (ctx) => {
      await ctx.reply('Додай подію або обери зі списку');
    });
    return eventMenu;
  }
  eventNameScene(): Scenes.BaseScene<MySceneContext> {
    const eventName = new Scenes.BaseScene<MySceneContext>('eventName');
    eventName.enter(async (ctx) => {
      ctx.reply('Вкажи назву події');
    });
    this.addCommands(eventName);
    eventName.on('text', async (ctx) => {
      this.event.eventName = ctx.message.text;
      this.event.userId = ctx.message.from.id;
      await ctx.scene.enter('eventTime');
    });
    eventName.on('message', async (ctx) => {
      await ctx.reply('Вкажи назву події');
    });
    return eventName;
  }
  eventTimeScene(): Scenes.BaseScene<MySceneContext> {
    const eventTime = new Scenes.BaseScene<MySceneContext>('eventTime');
    eventTime.enter(async (ctx) => {
      ctx.reply('Вкажи дату події');
    });
    this.addCommands(eventTime);
    eventTime.on('text', async (ctx) => {
      this.event.date = ctx.message.text;
      await ctx.scene.enter('eventAbout');
    });
    eventTime.on('message', async (ctx) => {
      await ctx.reply('Вкажи дату події');
    });

    return eventTime;
  }
  eventAboutScene(): Scenes.BaseScene<MySceneContext> {
    const eventAbout = new Scenes.BaseScene<MySceneContext>('eventAbout');
    eventAbout.enter(async (ctx) => {
      ctx.reply('Вкажи деталі події', Markup.keyboard(['Пропустити']).resize());
    });
    this.addCommands(eventAbout);
    eventAbout.hears('Пропустити', async (ctx) => {
      this.event.about = undefined;
      await ctx.scene.enter('eventAgeRange');
    });
    eventAbout.on('text', async (ctx) => {
      this.event.about = ctx.message.text;
      await ctx.scene.enter('eventAgeRange');
    });
    eventAbout.on('message', async (ctx) => {
      await ctx.reply('Вкажи деталі події');
    });

    return eventAbout;
  }
  eventAgeRangeScene(): Scenes.BaseScene<MySceneContext> {
    const eventAgeRange = new Scenes.BaseScene<MySceneContext>('eventAgeRange');
    eventAgeRange.enter(async (ctx) => {
      ctx.reply(
        'Який віковий діапазон?',
        Markup.keyboard([['18-20', '20-22', '22-25', 'Будь-який']]).resize()
      );
    });
    this.addCommands(eventAgeRange);
    eventAgeRange.hears('18-20', async (ctx) => {
      this.event.ageRange = '18-20';
      await ctx.reply(
        `Бінго! Очікуй на свій perfect match та неймовірно проведений час )`
      );
      await this.saveEventToDatabase(this.event);
      await ctx.scene.enter('greeting');
    });
    eventAgeRange.hears('20-22', async (ctx) => {
      this.event.ageRange = '20-22';
      await ctx.reply(
        `Бінго! Очікуй на свій perfect match та неймовірно проведений час )`
      );
      await this.saveEventToDatabase(this.event);
      await ctx.scene.enter('greeting');
    });
    eventAgeRange.hears('22-25', async (ctx) => {
      this.event.ageRange = '22-25';
      await ctx.reply(
        `Бінго! Очікуй на свій perfect match та неймовірно проведений час )`
      );
      await this.saveEventToDatabase(this.event);
      await ctx.scene.enter('greeting');
    });
    eventAgeRange.hears('Будь-який', async (ctx) => {
      this.event.ageRange = 'Будь-який';
      await ctx.reply(
        `Бінго! Очікуй на свій perfect match та неймовірно проведений час )`
      );
      await this.saveEventToDatabase(this.event);
      await ctx.scene.enter('greeting');
    });
    eventAgeRange.on('text', async (ctx) => {
      this.event.about = ctx.message.text;
      await ctx.scene.enter('eventAgeRange');
    });
    eventAgeRange.on('message', async (ctx) => {
      await ctx.reply('Вкажи деталі події');
    });

    return eventAgeRange;
  }

  userEventListScene(): Scenes.BaseScene<MySceneContext> {
    const userEvents = new Scenes.BaseScene<MySceneContext>('userEvents');
    userEvents.enter(async (ctx) => {
      const events = await this.getEventsFromDatabase(ctx.message?.from.id);
      if (events) {
        await ctx.reply(`Ось твої події:`);
        for (const event of events) {
          if (event.about) {
            await ctx.reply(`Назва події: ${event.eventName}
Дата та час події: ${event.date}
Деталі: ${event.about}`);
          } else {
            await ctx.reply(`Назва події: ${event.eventName}
Дата та час події: ${event.date}`);
          }
        }
        await ctx.scene.enter('greeting');
      } else {
        await ctx.reply('Ти ще не створив жодної події');
        await ctx.scene.enter('greeting');
      }
    });
    this.addCommands(userEvents);

    return userEvents;
  }

  addCommands(scene: Scenes.BaseScene<MySceneContext>) {
    scene.command('start', async (ctx) => {
      await ctx.reply(`Вітаємо в ком'юніті Дай Винника! 👋
          
👩 Дай Винник — незвичайний бот, який наповнить твоє життя приємними моментами. Він допоможе тобі знайти компаньона на якусь подію або просто прогулянку, а також знайти другу половинку, друга або подругу!
                        
🫂 Офіційний запуск повноцінного боту планується 25 серпня. Проте ти вже можеш створити й налаштувати свій профіль. Міцно обійняли тебе`);
      await ctx.scene.enter('greeting');
    });
    scene.command('events', async (ctx) => {
      await ctx.scene.enter('userEvents');
    });
    scene.command('profile', async (ctx) => {
      await ctx.scene.enter('userform');
    });
  }

  async saveUserFormToDatabase(userForm: UserForm) {
    try {
      await this.client.connect();
      const userFormData = new UserFormModel<UserForm>(userForm);
      const db = this.client.db('cluster0');
      if (await db.collection('users').findOne({ userId: userForm.userId })) {
        await db.collection('users').updateOne(
          { userId: userForm.userId },
          {
            $set: {
              // Cannot just pass an userFormdData obj as it causes error for some reason
              userId: userForm.userId,
              username: userForm.username,
              gender: userForm.gender,
              lookingFor: userForm.lookingFor,
              age: userForm.age,
              about: userForm.about,
              location: userForm.location,
              photoId: userForm.photoId,
            },
          }
        );
      } else {
        await db.collection('users').insertOne(userFormData);
      }
    } catch (error) {
      console.error('Error saving UserForm data:', error);
    } finally {
      await this.client.close();
    }
  }
  async saveEventToDatabase(event: Event) {
    try {
      await this.client.connect();
      const eventData = new EventModel<Event>(event);
      const db = this.client.db('cluster0');
      await db.collection('events').insertOne(eventData);
    } catch (error) {
      console.error('Error saving eventData data:', error);
    } finally {
      await this.client.close();
    }
  }
  async getUserFormDataFromDatabase(userId: number) {
    try {
      await this.client.connect();
      const db = this.client.db('cluster0');
      const userForm = await db.collection('users').findOne({ userId });
      return userForm;
    } catch (error) {
      console.error('Error getting userForm data from db', error);
    } finally {
      await this.client.close();
    }
  }
  async getEventsFromDatabase(userId: number | undefined) {
    try {
      await this.client.connect();
      const db = this.client.db('cluster0');
      const events = await db.collection('events').find({ userId }).toArray();
      return events;
    } catch (error) {
      console.error('Error getting events data from db', error);
    } finally {
      await this.client.close();
    }
  }

  async getUserCityFromCoordinates(latitude: number, longitude: number) {
    const apiUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&language=uk-UA&key=${this.API_KEY}`;
    try {
      const response = await axios.get(apiUrl);
      if (response.data.results.length > 0) {
        const addressComponents = response.data.results[0].address_components;
        const cityComponent = addressComponents.find(
          (component: { types: string | string[] }) =>
            component.types.includes('locality')
        );

        if (cityComponent) {
          const cityName = cityComponent.long_name;
          return cityName;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Error fetching user city:', error.message);
    }
  }
}
