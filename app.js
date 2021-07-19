const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3001, () =>
      console.log("Server Running at http://localhost:3001/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const validatePassword = (password) => {
  return password.length > 5;
};

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

app.post("/register/", async (request, response) => {
  const { username, name, password, gender, location } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const databaseUser = await database.get(selectUserQuery);

  if (databaseUser === undefined) {
    const createUserQuery = `
     INSERT INTO
      user (username, name, password, gender)
     VALUES
      (
       '${username}',
       '${name}',
       '${hashedPassword}',
       '${gender}'  
      );`;
    if (validatePassword(password)) {
      await database.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const databaseUser = await database.get(selectUserQuery);

  if (databaseUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      databaseUser.password
    );
    if (isPasswordMatched === true) {
      const payload = { username: username };
      let jwtToken = jwt.sign(payload, "SECRET");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const get_tweets_query = `
    SELECT username,tweet,date_time
    FROM user
        NATURAL JOIN tweet
    ORDER BY date_time DESC
    LIMIT 4;`;
  const tweets = await database.all(get_tweets_query);
  response.send(tweets);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const get_followers = `
    SELECT DISTINCT name
    FROM user
        INNER JOIN follower
        ON user.user_id=follower.follower_user_id
    WHERE user_id=follower_user_id;`;
  const names = await database.all(get_followers);
  response.send(names);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const get_name = `
    SELECT DISTINCT name
    FROM user
        INNER JOIN follower
        ON user.user_id=follower.follower_user_id
    WHERE user_id=follower_user_id;`;
  const followers = await database.all(get_name);
  response.send(followers);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const get_tweets = `
  SELECT tweet,
    COUNT(like_id) AS likes,
    COUNT(reply_id) AS replies,
    tweet.date_time
  FROM tweet
    NATURAL JOIN like
    NATURAL JOIN reply
  WHERE tweet_id=${tweetId}`;
  const tweet = await database.get(get_tweets);
  if (tweet.tweet === null) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    response.send(tweet);
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const likers = `
    SELECT name
    FROM user
        NATURAL JOIN tweet
        NATURAL JOIN like
    WHERE tweet_id=${tweetId};`;
    const name = await database.all(likers);
    console.log(name);
    if (name.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send({
        likes: name,
      });
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const tweet_query = `
    SELECT tweet
    FROM user
        NATURAL JOIN tweet
    WHERE tweet_id=${tweetId};`;
    const get_replies = `
    SELECT name,reply
    FROM user
    NATURAL JOIN reply
    NATURAL JOIN tweet
    WHERE tweet_id=${tweetId};`;
    const reply = await database.all(get_replies);
    const tweet = await database.get(tweet_query);
    if (reply.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send({ tweet: tweet, replies: reply });
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const get_tweet_query = `
    SELECT tweet,
        COUNT(like_id) AS likes,
        COUNT(reply_id) AS replies,
        tweet.date_time
    FROM user
        NATURAL JOIN tweet
        NATURAL JOIN like
        NATURAL JOIN reply;`;
  const tweet = await database.all(get_tweet_query);
  response.send(tweet);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const add_tweet = `
    INSERT INTO tweet(tweet)
    VALUES('${tweet}');`;
  await database.run(add_tweet);
  response.send("Created a Tweet");
});

app.delete("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;
  const delete_query = `
    SELECT user_id
    FROM user
    WHERE username='${username}'
    DELETE FROM tweet
    WHERE tweet_id=${tweetId}
        AND user.user_id=tweet.user_id;`;
  const del = await database.run(delete_query);
  console.log(del);
  if (del.changes === 1) {
    response.send("Tweet Removed");
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

module.exports = app;
