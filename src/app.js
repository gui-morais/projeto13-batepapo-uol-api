import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import joi from "joi";
import dayjs from "dayjs";
import { stripHtml } from "string-strip-html";
dotenv.config();

function formatNumber(n) {
  if (n > 9) {
    return `${n}`;
  } else {
    return `0${n}`;
  }
}

const mongoClient = new MongoClient(process.env.MONGO_URI);
let db;

try {
  await mongoClient.connect();
  db = mongoClient.db("batepapo-uol");
} catch (error) {
  console.log(error);
}

const app = express();
app.use(express.json());

const nameSchema = joi.object({
  name: joi.string().required(),
});

const messageSchema = joi.object({
  to: joi.string().required(),
  text: joi.string().required(),
  type: joi.string().valid("message", "private_message").required(),
});

app.post("/participants", async (req, res) => {
  const user = req.body;
  const validation = nameSchema.validate(user);

  if (validation.error) {
    res.status(422).send(validation.error.details[0].message);
    return;
  }

  const name = stripHtml(user.name).result;

  try {
    const verification = await db.collection("participants").findOne({ name });
    if (verification) {
      res.sendStatus(409);
      return;
    }
    await db
      .collection("participants")
      .insertOne({ name, lastStatus: Date.now() });
    const time =
      formatNumber(dayjs().hour()) +
      ":" +
      formatNumber(dayjs().minute()) +
      ":" +
      formatNumber(dayjs().second());
    await db
      .collection("messages")
      .insertOne({
        from: name,
        to: "Todos",
        text: "entra na sala...",
        type: "status",
        time,
      });
    res.sendStatus(201);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.get("/participants", async (req, res) => {
  try {
    const participants = await db.collection("participants").find({}).toArray();
    res.send(participants);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.post("/messages", async (req, res) => {
  const message = { ...req.body, text: stripHtml(req.body.text).result.trim() };
  const from = req.headers.user;
  const validation = messageSchema.validate(message, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    res.status(422).send(errors);
    return;
  }
  const { to, text, type } = message;

  try {
    const verification = await db
      .collection("participants")
      .findOne({ name: from });
    if (!verification) {
      res.status(422).send("Usuário não cadastrado");
      return;
    }

    const time =
      formatNumber(dayjs().hour()) +
      ":" +
      formatNumber(dayjs().minute()) +
      ":" +
      formatNumber(dayjs().second());
    await db.collection("messages").insertOne({ from, to, text, type, time });
    res.sendStatus(201);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.get("/messages", async (req, res) => {
  const user = req.headers.user;
  if (!user) {
    res.sendStatus(401);
  }
  const limit = req.query.limit;
  try {
    const messages = await db
      .collection("messages")
      .find({ $or: [{ to: "Todos" }, { to: user }, { from: user }] })
      .toArray();
    if (limit) {
      res.send(messages.slice(-limit));
      return;
    }
    res.send(messages);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.post("/status", async (req, res) => {
  const name = req.headers.user;
  try {
    const user = await db.collection("participants").findOne({ name });
    if (!user) {
      res.sendStatus(404);
      return;
    }
    await db
      .collection("participants")
      .updateOne(
        { _id: user._id },
        { $set: { ...user, lastStatus: Date.now() } }
      );
    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.delete("/messages/:id", async (req, res) => {
  const name = req.headers.user;
  const id = req.params.id;
  try {
    const message = await db
      .collection("messages")
      .findOne({ _id: new ObjectId(id) });
    if (!message) {
      res.sendStatus(404);
      return;
    }
    if (name !== message.from) {
      res.sendStatus(401);
      return;
    }
    await db.collection("messages").deleteOne({ _id: message._id });
    res.status(200).send("Mensagem apagada com sucesso");
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.put("/messages/:id", async (req, res) => {
  const message = { ...req.body, text: stripHtml(req.body.text).result.trim() };
  const from = req.headers.user;
  const id = req.params.id;
  const validation = messageSchema.validate(message, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    res.status(422).send(errors);
    return;
  }
  const { to, text, type } = message;

  try {
    const verificationFrom = await db
      .collection("participants")
      .findOne({ name: from });
    const verificationID = await db
      .collection("messages")
      .findOne({ _id: new ObjectId(id) });
    if (!verificationID) {
      res.sendStatus(404);
      return;
    }
    if (!verificationFrom) {
      res.sendStatus(401);
      return;
    }
    await db
      .collection("messages")
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { ...verificationID, to, text, type } }
      );
    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

setInterval(async () => {
  try {
    const participants = await db.collection("participants").find({}).toArray();
    participants.forEach(async (user) => {
      if (user.lastStatus <= Date.now() - 10000) {
        await db.collection("participants").deleteOne({ _id: user._id });
        const time =
          formatNumber(dayjs().hour()) +
          ":" +
          formatNumber(dayjs().minute()) +
          ":" +
          formatNumber(dayjs().second());
        await db
          .collection("messages")
          .insertOne({
            from: user.name,
            to: "Todos",
            text: "sai da sala...",
            type: "status",
            time,
          });
      }
    });
  } catch (error) {
    console.log(error);
  }
}, 15000);

app.listen(5000, () => {
  console.log("Server is listening on port 5000.");
});