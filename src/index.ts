import { Context, h, Logger, Schema } from 'koishi';
import {} from 'koishi-plugin-cron';

export const name = 'news';
const logger = new Logger(name);

declare module 'koishi' {
  interface Tables {
    news: News;
  }
}

export interface News {
  time: string;
  img: string;
}

export interface Config {
  point: number[];
}

export const Config: Schema<Config> = Schema.object({
  point: Schema.tuple([
    Schema.number().min(0).max(24),
    Schema.number().min(0).max(59),
  ])
    .default([8, 0])
    .description('小时，分钟，固定每天多少点发'),
});

export function apply(ctx: Context, config: Config) {
  ctx.cron(`${config.point[1]} ${config.point[0]} * * *`, async () => {
    let img;
    const data = await ctx.database.get('news', getCurrentDate());
    if (data.length != 0) {
      img = data[0].img;
    } else {
      img = await getNews();
      await ctx.database.create('news', {
        time: getCurrentDate(),
        img: img,
      });
    }

    await ctx.broadcast(h('image', { url: 'data:image/jpg;base64,' + img }));
  });

  ctx.model.extend(
    'news',
    {
      time: 'string',
      img: 'text',
    },
    { primary: 'time' },
  );

  ctx.command('news [date:text]').action(async (_, date) => {
    let data;
    if (date) {
      if (!isValidDate(date)) return '不是有效的日期';
      data = await ctx.database.get('news', date);
    } else data = await ctx.database.get('news', getCurrentDate());
    if (data.length != 0) {
      const img = data[0].img;
      return h('image', { url: 'data:image/jpg;base64,' + img });
    } else {
      const img = await getNews(date);
      await ctx.database.create('news', {
        time: date || getCurrentDate(),
        img: img,
      });
      return h('image', { url: 'data:image/jpg;base64,' + img });
    }
  });

  function isValidDate(str: string) {
    const pattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!pattern.test(str)) return false;

    const date = new Date(str);
    return !isNaN(date.getTime());
  }

  function getCurrentDate(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`;
    return formattedDate;
  }

  async function getNews(date?: string) {
    let imageUrl = 'https://ravelloh.github.io/EverydayNews';
    if (date) {
      const format = date.split('-');
      imageUrl += `/${format[0]}/${format[1]}/${date}.jpg`;
    } else {
      imageUrl += '/latest.jpg';
    }

    logger.info(`正在尝试获取${date}的${imageUrl}`);
    try {
      const response = await fetch(imageUrl);

      // Check if the response is successful
      if (!response.ok) {
        logger.error(`HTTP error! Status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return buffer.toString('base64');
    } catch (error) {
      logger.error('Error fetching image:', error.message);
      throw error;
    }
  }
}
