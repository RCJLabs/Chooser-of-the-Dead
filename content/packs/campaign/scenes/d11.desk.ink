# draft
// FIRST DRAFT (docs/tech-spec.md §59): rewrite or sign off. Freyja at the desk on Day 11, between her morning on Day 4
// and the quarrel over claims on Day 15. She's looking for her husband, Óðr, who went travelling and hasn't come back,
// and she weeps red gold for him (Gylfaginning). The sun holds while she's there.
The next in line isn't dead. She wears a cloak of falcon feathers and a necklace that makes the lamp look dim, and two grey cats sit down on the path behind her as if they own it.
"Don't get up," says Freyja. "I'm not here for anyone in this line." # speaker: freyja
"I'm looking for my husband. Óðr. He went travelling a long time ago. He's always travelling." # speaker: freyja
"Has he come through here? Tall. Restless. Looks at every road as if it owes him something." # speaker: freyja
* ["No one by that name."]
  "No. He'd have given you another." # speaker: freyja
* ["I'll watch for him."]
  # fx: flag watch_odr
  She looks at you for a long moment, as if deciding whether you mean it.
  "Everyone says that. You might be the first who does it." # speaker: freyja
- She sits on the edge of your desk and weeps, quite quietly, for about as long as it takes to stamp a soul. Her tears are gold. One rolls across the slate and stops against your inkpot: a red-gold bead, heavy and warm.
* [Send it home to Asa.]
  # fx: flag tear_asa
  "Do," she says, as if you'd asked. "Tell her it's a tear. She won't believe you." # speaker: freyja
* [Give it back.]
  # fx: standing freyja +1
  She takes it and turns it over in her fingers, surprised.
  "Nobody gives them back," she says. "I'll remember that." # speaker: freyja
- The cats get up when she does. By the time you look again the path is only a path, and the queue shuffles forward as if nothing happened.
-> END
