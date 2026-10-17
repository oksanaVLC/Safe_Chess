import type { Color, PieceSymbol } from "chess.js";
import type { Level } from "@/engine/ChessEngine";

export type Language = "en" | "es" | "ru";

export const LANGUAGES: Language[] = ["en", "es", "ru"];

/** Each language in its own name, for the globe menu. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  es: "Español",
  ru: "Русский",
};

interface Robot {
  name: string;
  tagline: string;
  /** Name after "You vs" (Russian needs the genitive case). */
  vsName: string;
}

export interface Strings {
  // Brief §6
  tagline: string;
  robot: string;
  robotSub: string;
  timed: string;
  timedSub: string;
  friend: string;
  friendSub: string;
  last: string;
  language: string;
  vs: string;
  level: string;
  turnHint: string;
  yourTurn: string;
  undo: string;
  moves: string;
  new: string;
  scan: string;
  orType: string;
  iPlay: string;
  white: string;
  black: string;
  surprise: string;
  share: string;
  waiting: string;
  gameMoves: string;
  move: string;
  of: string;
  whiteCol: string;
  blackCol: string;
  castles: string;

  // Play with a friend: start screen
  friendCreate: string;
  /** The creator always plays White. */
  friendCreateSub: string;
  friendJoin: string;
  /** The joiner always plays Black. */
  friendJoinSub: string;
  friendCodeLabel: string;
  friendJoinButton: string;
  invalidCode: string;
  // Play with a friend: creating a game
  /** This build has no Supabase settings. */
  friendUnavailable: string;
  friendError: string;
  tryAgain: string;
  /** After "Send the link instead" copied the link (no share sheet). */
  linkCopied: string;

  // Brief §4
  robots: Record<Level, Robot>;

  // Game messages
  thinking: (robot: string) => string;
  check: string;
  win: string;
  loss: (robot: string) => string;
  draw: string;

  // Robot with a clock
  /** The person ran out of time. */
  timeUpLoss: (robot: string) => string;
  /** The robot ran out of time (`robot` as in "You vs …"). */
  timeUpWin: (robotVs: string) => string;
  /** Screen-reader names of the two clocks. */
  robotClock: (robotVs: string) => string;
  yourClock: string;

  // Promotion picker
  choosePiece: string;
  cancel: string;
  /** Piece names as button labels. */
  pieceNames: Record<PieceSymbol, string>;

  // Game moves screen
  levels: string;
  start: string;

  // Screen-reader labels
  backHome: string;
  backToGame: string;
  firstMove: string;
  previousMove: string;
  nextMove: string;
  lastMove: string;
  boardAtStart: string;
  boardAfterMove: (move: number) => string;
  robotLevel: string;
  game: string;
  /** "white pawn", with the adjective agreeing with the piece. */
  pieceOnSquare: Record<Color, Record<PieceSymbol, string>>;
}

const en: Strings = {
  tagline: "Chess for kids — and grown-ups too",
  robot: "Play with a robot",
  robotSub: "5 levels, Snoozy to Titan",
  timed: "Robot with a clock",
  timedSub: "Play against the time",
  friend: "Play with a friend",
  friendSub: "Share a QR code",
  last: "See my last game",
  language: "Language",
  vs: "You vs",
  level: "Level",
  turnHint: "Your turn — tap a piece",
  yourTurn: "Your turn",
  undo: "Undo",
  moves: "Moves",
  new: "New",
  scan: "Ask your friend to scan this code with their phone",
  orType: "or type this code",
  iPlay: "I play with",
  white: "White",
  black: "Black",
  surprise: "Surprise",
  share: "Send the link instead",
  waiting: "Waiting for your friend…",
  gameMoves: "Game moves",
  move: "Move",
  of: "of",
  whiteCol: "White",
  blackCol: "Black",
  castles: "castles",

  friendCreate: "Create a game",
  friendCreateSub: "You play White",
  friendJoin: "Join with a code",
  friendJoinSub: "You play Black",
  friendCodeLabel: "Your friend's code",
  friendJoinButton: "Join",
  invalidCode: "That code doesn't work — check it and try again",
  friendUnavailable: "Playing with a friend isn't available right now",
  friendError: "Something went wrong — check your connection and try again",
  tryAgain: "Try again",
  linkCopied: "Link copied",

  robots: {
    1: { name: "Snoozy", tagline: "Just woke up", vsName: "Snoozy" },
    2: { name: "Bloop", tagline: "Learning the moves", vsName: "Bloop" },
    3: { name: "Gizmo", tagline: "Thinks a little", vsName: "Gizmo" },
    4: { name: "Sparks", tagline: "Quick and sneaky", vsName: "Sparks" },
    5: { name: "Titan", tagline: "The champion", vsName: "Titan" },
  },

  thinking: (robot) => `${robot} is thinking…`,
  check: "Check! Your turn",
  win: "Checkmate — you win!",
  loss: (robot) => `Checkmate — ${robot} wins this time`,
  draw: "It's a draw",

  timeUpLoss: (robot) => `Time's up — ${robot} wins this time`,
  timeUpWin: (robot) => `${robot} ran out of time — you win!`,
  robotClock: (robot) => `${robot}'s clock`,
  yourClock: "Your clock",

  choosePiece: "Choose a piece",
  cancel: "Cancel",
  pieceNames: { k: "King", q: "Queen", r: "Rook", b: "Bishop", n: "Knight", p: "Pawn" },

  levels: "Levels",
  start: "Start",

  backHome: "Back to home",
  backToGame: "Back to the game",
  firstMove: "First move",
  previousMove: "Previous move",
  nextMove: "Next move",
  lastMove: "Last move",
  boardAtStart: "Board at the start",
  boardAfterMove: (move) => `Board after move ${move}`,
  robotLevel: "Robot level",
  game: "Game",
  pieceOnSquare: {
    w: {
      k: "white king",
      q: "white queen",
      r: "white rook",
      b: "white bishop",
      n: "white knight",
      p: "white pawn",
    },
    b: {
      k: "black king",
      q: "black queen",
      r: "black rook",
      b: "black bishop",
      n: "black knight",
      p: "black pawn",
    },
  },
};

const es: Strings = {
  tagline: "Ajedrez para niños — y mayores también",
  robot: "Jugar con un robot",
  robotSub: "5 niveles, de Dormilón a Titán",
  timed: "Robot con tiempo",
  timedSub: "Juega contra el reloj",
  friend: "Jugar con un amigo",
  friendSub: "Comparte un código QR",
  last: "Ver mi última partida",
  language: "Idioma",
  vs: "Tú contra",
  level: "Nivel",
  turnHint: "Tu turno — toca una pieza",
  yourTurn: "Tu turno",
  undo: "Deshacer",
  moves: "Jugadas",
  new: "Nueva",
  scan: "Pide a tu amigo que escanee este código con su móvil",
  orType: "o escribe este código",
  iPlay: "Juego con",
  white: "Blancas",
  black: "Negras",
  surprise: "Sorpresa",
  share: "Enviar el enlace",
  waiting: "Esperando a tu amigo…",
  gameMoves: "Jugadas de la partida",
  move: "Jugada",
  of: "de",
  whiteCol: "Blancas",
  blackCol: "Negras",
  castles: "enroque",

  friendCreate: "Crear partida",
  friendCreateSub: "Juegas con blancas",
  friendJoin: "Unirse con un código",
  friendJoinSub: "Juegas con negras",
  friendCodeLabel: "El código de tu amigo",
  friendJoinButton: "Unirse",
  invalidCode: "Ese código no funciona — revísalo e inténtalo otra vez",
  friendUnavailable: "Jugar con un amigo no está disponible ahora",
  friendError: "Algo ha fallado — revisa la conexión e inténtalo otra vez",
  tryAgain: "Intentar de nuevo",
  linkCopied: "Enlace copiado",

  robots: {
    1: { name: "Dormilón", tagline: "Recién despertado", vsName: "Dormilón" },
    2: { name: "Blup", tagline: "Aprendiendo a mover", vsName: "Blup" },
    3: { name: "Gizmo", tagline: "Piensa un poquito", vsName: "Gizmo" },
    4: { name: "Chispa", tagline: "Rápido y astuto", vsName: "Chispa" },
    5: { name: "Titán", tagline: "El campeón", vsName: "Titán" },
  },

  thinking: (robot) => `${robot} está pensando…`,
  check: "¡Jaque! Tu turno",
  win: "¡Jaque mate — has ganado!",
  loss: (robot) => `Jaque mate — esta vez gana ${robot}`,
  draw: "Es un empate",

  timeUpLoss: (robot) => `Se acabó el tiempo — esta vez gana ${robot}`,
  timeUpWin: (robot) => `A ${robot} se le acabó el tiempo — ¡has ganado!`,
  robotClock: (robot) => `Reloj de ${robot}`,
  yourClock: "Tu reloj",

  choosePiece: "Elige una pieza",
  cancel: "Cancelar",
  pieceNames: { k: "Rey", q: "Reina", r: "Torre", b: "Alfil", n: "Caballo", p: "Peón" },

  levels: "Niveles",
  start: "Inicio",

  backHome: "Volver al inicio",
  backToGame: "Volver a la partida",
  firstMove: "Primera jugada",
  previousMove: "Jugada anterior",
  nextMove: "Jugada siguiente",
  lastMove: "Última jugada",
  boardAtStart: "Tablero al inicio",
  boardAfterMove: (move) => `Tablero tras la jugada ${move}`,
  robotLevel: "Nivel del robot",
  game: "Partida",
  pieceOnSquare: {
    w: {
      k: "rey blanco",
      q: "reina blanca",
      r: "torre blanca",
      b: "alfil blanco",
      n: "caballo blanco",
      p: "peón blanco",
    },
    b: {
      k: "rey negro",
      q: "reina negra",
      r: "torre negra",
      b: "alfil negro",
      n: "caballo negro",
      p: "peón negro",
    },
  },
};

const ru: Strings = {
  tagline: "Шахматы для детей — и для взрослых",
  robot: "Играть с роботом",
  robotSub: "5 уровней: от Сони до Титана",
  timed: "Робот на время",
  timedSub: "Игра с часами",
  friend: "Играть с другом",
  friendSub: "Поделись QR-кодом",
  last: "Моя последняя партия",
  language: "Язык",
  vs: "Ты против",
  level: "Уровень",
  turnHint: "Твой ход — нажми на фигуру",
  yourTurn: "Твой ход",
  undo: "Отменить",
  moves: "Ходы",
  new: "Заново",
  scan: "Попроси друга отсканировать этот код телефоном",
  orType: "или введи этот код",
  iPlay: "Я играю",
  white: "Белыми",
  black: "Чёрными",
  surprise: "Случайно",
  share: "Отправить ссылку",
  waiting: "Ждём твоего друга…",
  gameMoves: "Ходы партии",
  move: "Ход",
  of: "из",
  whiteCol: "Белые",
  blackCol: "Чёрные",
  castles: "рокировка",

  friendCreate: "Создать игру",
  friendCreateSub: "Ты играешь белыми",
  friendJoin: "Войти по коду",
  friendJoinSub: "Ты играешь чёрными",
  friendCodeLabel: "Код друга",
  friendJoinButton: "Войти",
  invalidCode: "Этот код не подходит — проверь и попробуй ещё раз",
  friendUnavailable: "Игра с другом сейчас недоступна",
  friendError: "Что-то пошло не так — проверь интернет и попробуй ещё раз",
  tryAgain: "Попробовать ещё раз",
  linkCopied: "Ссылка скопирована",

  robots: {
    1: { name: "Соня", tagline: "Только проснулся", vsName: "Сони" },
    2: { name: "Блуп", tagline: "Учит ходы", vsName: "Блупа" },
    3: { name: "Гизмо", tagline: "Немного думает", vsName: "Гизмо" },
    4: { name: "Искра", tagline: "Быстрый и хитрый", vsName: "Искры" },
    5: { name: "Титан", tagline: "Чемпион", vsName: "Титана" },
  },

  thinking: (robot) => `${robot} думает…`,
  check: "Шах! Твой ход",
  win: "Мат — победа за тобой!",
  loss: (robot) => `Мат — в этот раз побеждает ${robot}`,
  draw: "Ничья",

  timeUpLoss: (robot) => `Время вышло — в этот раз побеждает ${robot}`,
  timeUpWin: (robot) => `У ${robot} вышло время — победа за тобой!`,
  robotClock: (robot) => `Часы ${robot}`,
  yourClock: "Твои часы",

  choosePiece: "Выбери фигуру",
  cancel: "Отмена",
  pieceNames: { k: "Король", q: "Ферзь", r: "Ладья", b: "Слон", n: "Конь", p: "Пешка" },

  levels: "Уровни",
  start: "Начало",

  backHome: "На главную",
  backToGame: "Назад к партии",
  firstMove: "Первый ход",
  previousMove: "Предыдущий ход",
  nextMove: "Следующий ход",
  lastMove: "Последний ход",
  boardAtStart: "Доска в начале партии",
  boardAfterMove: (move) => `Доска после хода ${move}`,
  robotLevel: "Уровень робота",
  game: "Партия",
  pieceOnSquare: {
    w: {
      k: "белый король",
      q: "белый ферзь",
      r: "белая ладья",
      b: "белый слон",
      n: "белый конь",
      p: "белая пешка",
    },
    b: {
      k: "чёрный король",
      q: "чёрный ферзь",
      r: "чёрная ладья",
      b: "чёрный слон",
      n: "чёрный конь",
      p: "чёрная пешка",
    },
  },
};

export const STRINGS: Record<Language, Strings> = { en, es, ru };
