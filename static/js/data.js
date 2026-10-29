// Word banks and text generators for Typing Race.

export const MODES = {
  "time-15": { label: "15s", duration: 15, kind: "time", name: "15 second test" },
  "time-30": { label: "30s", duration: 30, kind: "time", name: "30 second test" },
  "time-60": { label: "60s", duration: 60, kind: "time", name: "60 second test" },
  quote: { label: "quote", duration: null, kind: "quote", name: "quote test" },
};

export const MODE_ORDER = ["time-15", "time-30", "time-60", "quote"];

export const CUSTOM_TIME = { min: 5, max: 300, default: 45 };

const CUSTOM_MODE_RE = /^time-(\d{1,3})$/;

/** Resolve a fixed preset or a custom "time-<seconds>" mode. */
export function getMode(mode) {
  if (MODES[mode]) return MODES[mode];
  const match = CUSTOM_MODE_RE.exec(String(mode || ""));
  const duration = match ? Number(match[1]) : NaN;
  if (Number.isInteger(duration) && duration >= CUSTOM_TIME.min && duration <= CUSTOM_TIME.max) {
    return {
      label: `${duration}s`,
      duration,
      kind: "time",
      name: `${duration} second test`,
      custom: true,
    };
  }
  return MODES["time-30"];
}

export function isCustomMode(mode) {
  return MODES[mode] === undefined && getMode(mode).custom === true;
}

export function isValidMode(mode) {
  return Boolean(MODES[mode]) || getMode(mode).custom === true;
}

export function customModeFor(seconds) {
  const value = Math.round(Number(seconds) || 0);
  const clamped = Math.min(CUSTOM_TIME.max, Math.max(CUSTOM_TIME.min, value));
  return `time-${clamped}`;
}

const WORDS = `
about above across action active actual almost alone along already always amazing
among amount ancient animal answer anyone appear apple around arrive art ask away
back balance basic beach beautiful become before begin behind believe below best
better between beyond big bird black blue board body book both bright bring build
business busy button call calm camera carry case catch cause center certain change
chance check child choice choose city claim class clean clear climb close cloud
code cold color come common company complete computer control cool copy corner
could country course cover create cross current cut dance dark data day deal deep
design detail develop die different difficult direct discover discuss do doctor
door down draw dream drive drop each early earth ease east easy edge effect eight
either else end energy enjoy enough enter even event ever every example exist
experience explain eye face fact fall family far fast father feel few field fight
figure fill film final find fine fire first fish five follow food foot force form
forward four free friend from front full fun future game garden general get girl
give glass go goal good great green group grow guess half hand happen happy hard
have head health hear heart help here high history hold home hope horse hot hour
house how human hundred idea image imagine impact important improve include inside
instead interest into issue item join just keep key kid kind know land language
large last late later laugh law lead learn leave left less let letter level life
light like line list listen little live local long look lose love low machine
main make man many mark market matter may maybe mean measure meet member memory
message middle might mile mind minute miss model moment money month more morning
most mother mountain move much music must name near need never new next night
north note nothing notice now number object ocean off offer office often oil old
once one only open option order other out over own page paint paper part party
pass past pay people perhaps person phone pick picture piece place plan play point
power practice prepare present pretty problem process produce program project
protect provide public pull push put question quick quiet race radio rain raise
reach read ready real reason receive record red remember remove repeat report
rest result return right river road rock room round rule run safe same save say
school science score screen sea search season second see seem sell send sense
serve set seven share short should show side sign simple since sing six size skill
slow small smile snow social soft some song soon sound south space speak special
speed spend stand start state stay step still stop story street strong study such
summer sun sure system table take talk teach team tell ten test than thank that
their them then there these they thing think this those though thought three
through time today together tell tomorrow too top total touch toward town track
trade train travel tree true try turn two type under understand until upon use
usual value very view visit voice wait walk want warm watch water way wear week
weight well west what when where which while white who whole why wide will win
wind window wish with within without word work world worry would write wrong year
yes yesterday yet you young your
`.trim().split(/\s+/);

const QUOTES = [
  "The only way to do great work is to love what you do. If you have not found it yet, keep looking. Do not settle.",
  "Success is not final, failure is not fatal: it is the courage to continue that counts.",
  "Programs must be written for people to read, and only incidentally for machines to execute.",
  "Simplicity is the ultimate sophistication. Everything should be made as simple as possible, but not simpler.",
  "The future belongs to those who believe in the beauty of their dreams and the work required to reach them.",
  "It is not the strongest of the species that survives, nor the most intelligent; it is the one most adaptable to change.",
  "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.",
  "Life is like riding a bicycle. To keep your balance, you must keep moving forward, one small push at a time.",
  "The best time to plant a tree was twenty years ago. The second best time is now, so begin today.",
  "Do not go where the path may lead. Go instead where there is no path and leave a trail behind you.",
  "A ship in harbor is safe, but that is not what ships are built for. Set sail and test the open water.",
  "Creativity is intelligence having fun, and curiosity is the spark that turns ordinary ideas into something remarkable.",
  "We are what we repeatedly do. Excellence, then, is not an act but a habit built through steady practice.",
  "The greatest glory in living lies not in never falling, but in rising every time we fall.",
  "Technology is best when it brings people together and makes difficult things feel effortless.",
  "If you want to go fast, go alone. If you want to go far, go together with people you trust.",
  "Your time is limited, so do not waste it living someone else's life or chasing someone else's definition of success.",
  "The secret of getting ahead is getting started. The secret of getting started is breaking complex tasks into small steps.",
  "Imagination is more important than knowledge, for knowledge is limited while imagination circles the world.",
  "Great things are done by a series of small things brought together with patience and attention.",
];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Build a random stream of words long enough for the longest timed test.
 * Words are optionally decorated with punctuation and numbers.
 */
export function generateWords(count = 260, { punctuation = true, numbers = false } = {}) {
  const words = [];
  let capitalizeNext = false;
  let previous = "";

  for (let index = 0; index < count; index += 1) {
    let word = randomItem(WORDS);
    if (word === previous) word = randomItem(WORDS);
    previous = word;

    if (numbers && Math.random() < 0.08) {
      word = String(randomInt(1, 1200));
    }

    if (punctuation) {
      if (index === 0 || capitalizeNext) {
        word = word.charAt(0).toUpperCase() + word.slice(1);
        capitalizeNext = false;
      }
      const roll = Math.random();
      if (roll < 0.11) {
        word += ",";
      } else if (roll < 0.19) {
        word += ".";
        capitalizeNext = true;
      } else if (roll < 0.23) {
        word += "?";
        capitalizeNext = true;
      } else if (roll < 0.26) {
        word += "!";
        capitalizeNext = true;
      } else if (roll < 0.31) {
        word += ";";
      }
    }

    words.push(word);
  }

  return words.join(" ");
}

export function randomQuote() {
  return randomItem(QUOTES);
}

export function buildText(mode, options = {}) {
  if (mode === "quote") return randomQuote();
  const meta = getMode(mode);
  // Enough text for the whole run, with headroom for very fast typists.
  const words = Math.min(2600, Math.max(220, Math.ceil((meta.duration || 30) * 8)));
  return generateWords(words, options);
}
