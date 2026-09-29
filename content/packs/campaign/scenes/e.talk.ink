# draft
// FIRST DRAFT (game phase 8, docs/tech-spec.md §74): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// Night 14, after the night's own scene: what they say of you at home, from the word among the dead (§73) and the souls
// you've sent wrong.
EXTERNAL home(id)
EXTERNAL word()
EXTERNAL wrong()
{
- home("mother"):
  A letter from your mother comes late, and ends with the thing she meant to say first.
- home("brother"):
  A letter from Ulf comes late, and ends with the thing he meant to say first.
- else:
  A letter from your aunt comes late. She writes the way she talks, all at once.
}
{
- word() <= -2:
  "They say at the well that the new chooser at Odin's gate can't be moved. That the dead have stopped asking you for anything. I said you were always like that. I meant it kindly. It didn't come out kindly."
- word() >= 2:
  "They say at the well that the chooser at Odin's gate will hear anyone out, and that some of the dead have lied their way past you. Be careful. Kindness is a door, and not everyone who comes through it wipes their feet."
- else:
  "Nobody at the well can agree what you're like at the gate. That seems right to me. You were always two people before breakfast."
}
{
- wrong() >= 15:
  "Skögul's raven stopped at the house. It asked whether you sleep. I said yes. Do you?"
- wrong() <= 3:
  "The jarl's steward says the gate has never been so orderly. He said it to me as if I'd done it."
}
* [Write back that you're well.]
  You write that you're well, and that the dead are no trouble. You're getting good at that sentence.
* [Write back the truth.]
  You write about the queue, and the sun, and the ones who ask. It takes all the bark you have.
- -> END
