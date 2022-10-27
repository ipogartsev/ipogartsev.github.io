const express = require('express')
const path = require('path')
const expressValidator = require('express-validator')
const expressLayouts = require('express-ejs-layouts')
const flash = require('connect-flash')
const session = require('express-session')
const passport = require('passport')
const mongoose = require('mongoose')
const db = require('./config/data').mongoURI
const secret = require('./config/data').secret
const helmet = require('helmet')

const PORT = process.env.PORT || 5000

const routes = require('./routes/index')
const users = require('./routes/users')

const Game = require('./server/game.js')

//Init app
const app = express()

//Security HTTP Headers
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
)

// DB
mongoose
  .connect(db, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB Connected'))
  .catch((err) => console.log(err))

// View engine
app.set('view engine', 'ejs')
app.use(expressLayouts)

// express bodyParser
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(
  '/socket.io-client',
  express.static(path.join(__dirname, 'node_modules/socket.io-client/dist')),
)

//Bootsrap css
app.use(
  '/bootstrap/css',
  express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')),
)

//Bootsrap js
app.use(
  '/bootstrap/js',
  express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')),
)

//jQuery
app.use(
  '/jquery',
  express.static(path.join(__dirname, 'node_modules/jquery/dist')),
)
// Set static folder
app.use(express.static(path.join(__dirname, 'public')))

app.use(express.static('public'))

// Express session
app.use(
  session({
    secret: secret,
    resave: true,
    saveUninitialized: true,
    cookie: { secure: false },
  }),
)

app.use(passport.initialize())
app.use(passport.session())

// Connect flash
app.use(flash())
// Global variables
app.use(function (req, res, next) {
  res.locals.success_msg = req.flash('success_msg')
  res.locals.error_msg = req.flash('error_msg')
  res.locals.error = req.flash('error')
  next()
})

// catch 404 and forward to error handler
// app.use(function (req, res, next) {
//   next(createError(404));
// });

//App routes
app.use('/', routes)
app.use('/users', users)

//Init socket.io
const server = app.listen(PORT)
const io = require('socket.io')(server)
const { Socket } = require('socket.io')

//Socket.io rooms
let rooms = []

/**
 * @type {Socket}
 */
io.on('connection', (socket) => {
  console.log(`[connection] ${socket.id}`)

  socket.on('playerData', (player) => {
    let room = null

    if (!player.roomId) {
      room = createRoom(player)
      console.log(`[create room] - ${room.id} - ${player.username}`)
    } else {
      room = rooms.find((r) => r.id === player.roomId)

      if (room === undefined) {
        return
      }

      player.roomId = room.id
      room.players.push(player)
    }

    socket.join(room.id)

    io.to(socket.id).emit('join room', room.id)

    // init paddle
    room.game.spawnPaddle()
    // init level
    room.game.spawnLevel()
    // init background particles
    room.game.initParticles()
    // init ball
    room.game.spawnBall(player.paddleX, player.paddleY)

    io.to(room.id).emit('play', player, room.game)
  })

  socket.on('play', (player) => {
    const room = rooms.find((r) => r.id === player.roomId)

    io.to(player.roomId).emit('play', player, room.game)
  })

  socket.on('collision detection', (player) => {
    const room = rooms.find((r) => r.id === player.roomId)
    //console.log(`[collision detection] - ${player.id} - ${player.username}`)
    if (room === undefined) {
      return
    }

    room.game.player = {
      paddleX: player.paddleX,
      paddleY: player.paddleY,
    }

    // update timer
    room.game.spawnTimer()
    // update paddle axis
    room.game.movePaddle()
    // update background particles
    room.game.moveParticles()
    // check for collision (balls, paddles, bricks)
    room.game.collisionDetection()
    // check for collision (paddles, bonuses)
    room.game.collisionBonusesDetection()
    // check if a winner
    room.game.calculateWin()
    // check for bonus lifespan
    room.game.checkConsumable()

    io.to(player.roomId).emit('play', player, room.game)
  })

  socket.on('play again waiting area', (player) => {
    const room = rooms.find((r) => r.id === player.roomId)

    io.to(room.id).emit('play again waiting area', room.players)
  })

  socket.on('play again', (player) => {
    const room = rooms.find((r) => r.id === player.roomId)

    //Init Game
    room.game = new Game(
      room.game.level,
      {
        paddleX: player.paddleX,
        paddleY: player.paddleY,
      },
      0,
      2,
    )

    // init paddle
    room.game.spawnPaddle()
    // init level
    room.game.spawnLevel()
    // init background particles
    room.game.initParticles()
    // init ball
    room.game.spawnBall(player.paddleX, player.paddleY)

    io.to(room.id).emit('play', player, room.game)
  })

  socket.on('next level', (player) => {
    // console.log(`[next level] - ${player.id} - ${player.username}`)
    const room = rooms.find((r) => r.id === player.roomId)
    if (room === undefined) {
      return
    }

    //Init Game
    room.game = new Game(
      room.game.level + 1,
      {
        paddleX: player.paddleX,
        paddleY: player.paddleY,
      },
      room.game.score,
      room.game.lives,
    )

    // init paddle
    room.game.spawnPaddle()
    // init level
    room.game.spawnLevel()
    // init background particles
    room.game.initParticles()
    // init ball
    room.game.spawnBall(player.paddleX, player.paddleY)

    io.to(room.id).emit('play', player, room.game)
  })

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`)
    let room = null

    rooms.forEach((r) => {
      r.players.forEach((p) => {
        if (p.socketId === socket.id && p.host) {
          room = r
          rooms = rooms.filter((r) => r !== room)
        }
      })
    })
  })
})

function createRoom(player) {
  const room = {
    id: roomId(),
    players: [],
    game: new Game(
      1,
      {
        paddleX: player.paddleX,
        paddleY: player.paddleY,
      },
      2,
      2,
    ),
  }
  player.roomId = room.id

  room.players.push(player)
  rooms.push(room)

  return room
}

function roomId() {
  return Math.random().toString(36).substr(2, 9)
}
