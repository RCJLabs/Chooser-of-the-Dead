# draft
// FIRST DRAFT (phase 6): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// The seeress's choice (docs/tech-spec.md §72): the valley has heard the end is coming, and queues at your mother's door to ask Heid when.
EXTERNAL home(id)
EXTERNAL sick(id)
{ not home("heid"): -> gone }
A letter from Heid, cut small and straight as ever, though the lines lean now.
"Every raven in the valley is gossiping about the seeress Odin woke in her grave. She was a Heid. We all are, the ones who see. It saves him learning names." # speaker: heid
"The valley has heard something is coming. They queue at your mother's door to ask me when. They bring cheese. The jarl's steward brought a ring." # speaker: heid
{ sick("heid"):
  "I see them from my bed. Seeing is easier lying down. Everything else is harder." # speaker: heid
}
"A ring a question, and your mother's pot is full to the end. Or I send them home with the truth, for nothing, and they curse me for it on the way." # speaker: heid
* [Tell her to take their rings.]
  # fx: rings +10
  # fx: flag heid_paid
  You write that the pot comes first. By dawn the raven brings ten rings and a note: "The steward asked twice. I charged him twice."
* [Tell her to give them the truth.]
  # fx: flag heid_honest
  You write that they should hear it for nothing. Heid's answer is one line.
  "They didn't thank me. They went home and held their children. That's thanks enough, in the end, which is soon." # speaker: heid
- The ravens on the roof of the long hall are quiet tonight, for once, as if someone told them off.
-> END

=== gone ===
Every raven at the gate is talking about the seeress Odin woke in her grave. Heid always said the ones who see go down to Hel like anyone else, and don't get a bench, and don't mind. You hope she was right about the last part.
-> END
