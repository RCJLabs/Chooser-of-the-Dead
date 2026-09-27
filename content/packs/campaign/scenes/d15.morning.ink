# draft
// FIRST DRAFT (M7): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
EXTERNAL flag(name)
Two decrees this morning. One is birch bark, in the quartermaster's very small hand. The other is a feather written on in gold, and it is already arguing with the first.
Odin now names his own claim each day, as Freyja does. When both of them want the same worthy soul, Odin's claim wins.
Freyja arrives before the first soul does. The dead in the queue turn toward her like flowers, and then, uncertainly, back toward the hall, as if they're no longer sure where the sun is.
// Her visit on Day 11 (docs/tech-spec.md §59).
{ flag("watch_odr"):
  "Still watching for him?" she asks you, before anything else, and doesn't wait for the answer. # speaker: freyja
}
"Half," she says. "Half the slain are mine. It's in the old songs. It isn't in his new decrees." # speaker: freyja
"Today he claims the scarred, or the ones with good swords. Tomorrow he'll claim everyone with two feet." # speaker: freyja
"You hold the stamp, little chooser. When he and I both want a soul, you can still send it to my field. He'll be angry. I'll remember." # speaker: freyja
Skögul is suddenly very busy with a loaf of bread.
* ["I'll remember too, lady."]
  # fx: standing freyja +2
  # fx: standing odin -1
  # fx: flag sided_freyja
  Freyja smiles, and it's like a door opening onto a warm room.
  "Good. Choose well, then. Choose me." # speaker: freyja
* ["The decree says Valhalla."]
  # fx: standing odin +2
  # fx: standing freyja -1
  # fx: flag sided_odin
  "Decrees change," says Freyja. "Ask Hel." # speaker: freyja
  The smell of apples goes out of the air all at once.
* ["I'll stamp what the Order says, and you can both be angry."]
  Freyja looks at you for a long moment, and then, surprisingly, laughs.
  "Skögul, you've trained this one too well." # speaker: freyja
  "I know," says Skögul, through the bread. # speaker: skogul
- The first soul in the queue looks from Freyja to the hall and back, and asks you where they're going.
-> END
