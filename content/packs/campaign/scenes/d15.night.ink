# draft
// FIRST DRAFT (M7): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
EXTERNAL flag(name)
EXTERNAL home(id)
EXTERNAL rings()
{
- home("mother"):
  Your mother's letter is written very small, to fit more on the bark.
  // She climbed the hill (docs/tech-spec.md §50).
  { flag("ragna_hill"):
    "My chest is quiet. The women on the hill gave me a stone and told me to keep it warm. I'd thank you not to tell anyone you carried me." # speaker: mother
  }
  "There's a ferryman at the mouth of the fjord. He's been there since the autumn. People say he's older than the rocks, and he won't give his name." # speaker: mother
  "He says there's a shore across the water the wolf will never reach. He'll carry anyone there when the horn blows. Twenty rings now, to hold a place. A hundred more on the day." # speaker: mother
  "The Olafssons paid him. Old Bera paid him. Everyone with rings is paying him, and everyone without is pretending they don't believe in him." # speaker: mother
  "You're closer to the gods than we are. Is there such a shore?" # speaker: mother
- home("brother"):
  Ulf's letter is short and very square.
  "There's a ferryman at the mouth of the fjord. He says there's a shore the wolf won't reach. Twenty rings now to hold a place, a hundred more on the day the horn blows." # speaker: ulf
  "I think he's a liar. I think I'd pay him anyway. Tell me I'm a fool." # speaker: ulf
- else:
  Your aunt writes for Asa. A ferryman at the mouth of the fjord says there's a shore the wolf will never reach. Twenty rings now to hold a place, a hundred more on the day the horn blows.
}
You don't know. Nobody at the gate has ever mentioned a shore. But nobody at the gate ever mentions anything.
* [Send twenty rings for a place on the ferry. #needs: rings 20]
  # fx: rings -20
  # fx: flag ferryman
  You wrap the rings in your answer. A hundred more by the day the horn blows. You start counting before the raven's out of sight.
* [Tell them to wait.]
  # fx: flag ferryman_doubted
  You write that you'll ask around. You don't know who you'd ask.
* [Tell them the gods will hold.]
  # fx: standing odin +1
  You write it firmly, the way Skögul says things. It looks less firm on the bark.
- On the shingle below the gate, where nobody ever lands, a small grey boat has been drawn up that wasn't there this morning. There's nobody in it.
-> levy

// The levy (docs/tech-spec.md §51): Solveig's boy goes to hold the pass, and Ulf, if he's home, wants to go too.
// Money can't keep him: the steward would take silver, but Ulf won't be bought out.
=== levy ===
{ flag("ulf_home") && home("brother"): -> levy_ulf }
The raven has one more scrap of bark, squeezed in at the bottom: Solveig's boy, Kari, has gone up to the pass with the jarl's levy, with his father's spear. # beat
-> ride

=== levy_ulf ===
Folded into the bark is a second letter, in Ulf's square hand. # beat
"The jarl's calling the levy to hold the pass before the snow shuts it. Kari, Solveig's boy, has taken his father's spear down off the wall. He's going." # speaker: ulf
"I want to go with him. Somebody should stand next to him who knew his mother." # speaker: ulf
- (choose)
* ["Go, then. Keep your shield up."]
  # fx: flag ulf_levy
  # fx: standing odin +1
  You write it, and then you write it again, bigger, because your hand wasn't steady the first time.
* [Pay the jarl's steward to strike his name.]
  You wrap twenty rings in a note to the steward. The raven comes back with them, and a line in Ulf's hand: "Keep your rings. I'm not a debt."
  -> choose
* ["Stay. They need you at home."]
  # fx: flag ulf_stayed
  You write that the house needs a man who can mend a roof more than the pass needs one more spear. It's true. He won't thank you for it.
- -> ride

// The levy's fight is at sunrise, and Skögul will take you over it to choose who falls (docs/tech-spec.md §78).
=== ride ===
Late, Skögul puts her head round the door with her cloak already on.
"Sleep in your boots," she says. "We ride before light. There's a fight at the pass at sunrise, and Odin wants one of them." # speaker: skogul
-> END
