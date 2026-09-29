# draft
// FIRST DRAFT (game phase 8, docs/tech-spec.md §74): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// Night 7, once Oddny was judged: what your mother writes, by where you sent her.
EXTERNAL flag(name)
EXTERNAL home(id)
{ not home("mother"): -> END }
{
- flag("oddny_meadow"):
  Your mother writes before the raven has even rested.
  "Hild at the well dreamed of Oddny dancing, barefoot, in a meadow full of women. She's told everyone. I haven't said a word." # speaker: mother
  "Thank you. Don't do it again for anyone. I heard what they fine you." # speaker: mother
- flag("oddny_hel"):
  Your mother's letter is short.
  "I heard Oddny went where the sick go. Hel's hall is warm, they say, and she always felt the cold." # speaker: mother
  { flag("oddny_promised"):
    "You said you'd look for her, and I know you did. I shouldn't have asked." # speaker: mother
  - else:
    "You told me the rules are the rules. I know. I shouldn't have asked." # speaker: mother
  }
- else:
  Your mother asks where Oddny went. You don't know how to answer her, so you write about the weather.
}
* [Burn a candle for Oddny.]
  It's a small candle. It's what you have.
* [Go to sleep.]
  You sleep, eventually.
- -> END
