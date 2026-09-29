# draft
// FIRST DRAFT (M7): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
EXTERNAL flag(name)
EXTERNAL home(id)
EXTERNAL sick(id)
EXTERNAL rings()
{
- home("mother"):
  Your mother's letter smells of the peat fire. It's been folded and unfolded many times before it was sent.
  { flag("ulf_shipyard") && home("brother"):
    "No word from Ulf this week. They say the north has a great deal of weather." # speaker: mother
    "A man from his shipyard fell off the scaffold into the fjord. Not Ulf. I made them say it twice." # speaker: mother
  }
  { flag("ulf_debt") && flag("ulf_home") && home("brother"):
    "Ulf spoke at the Thing. The jarl fined him anyway, but only half, and said he'd never heard a man say sorry so well." # speaker: mother
  }
  "A man came to the door yesterday. A carver, very polite. He said he could cut a new tally for your grandfather. A better one: that he died with his axe in his hand, not in his bed with the fever." # speaker: mother
  "He said the gods would read it and move him to the golden hall. Twelve rings. Families all over the valley are doing it, he says." # speaker: mother
  "I told him to come back tomorrow. I wanted to ask you first. You'd know." # speaker: mother
- home("brother"):
  Ulf's letter is short.
  "A carver came to the door. He offered to cut a new tally for Mother. A better one, he said, so the gods would read it and take her to a golden hall instead of a cold one. Twelve rings." # speaker: ulf
  "I nearly paid him. Tell me I was right not to." # speaker: ulf
- else:
  Your aunt writes for Asa. A carver has been going door to door in the valley, offering the families of the dead better tallies than the ones they were buried with. Twelve rings each. She wants to know whether it's true that the gods can be fooled.
}
You would know. You spent the afternoon dropping tallies like that into a basket.
* [Tell them the truth: it won't work.]
  # fx: flag letters_honest +1
  # fx: standing hel +1
  You write that a forged tally doesn't move anyone anywhere, that you'd see it under the lens, and that the dead are where they are.
  "Hel keeps a quiet hall," you write. It's all you know about it.
* [Ask for the carver's name.]
  # fx: flag hunt_carver
  # fx: standing odin +1
  You ask for the carver's name. The next raven brings three: three carvers have been at doors in the valley this month, and nobody at home can say which of them knocked. Skögul reads the list and pins it to the wall above your desk.
  "Every knife has its habits," she says. "Watch the tallies. When you're sure, give me a name, and the jarl will do the rest. You get one." # speaker: skogul
* [Tell them the dead are happy where they are.]
  # fx: flag letters_kind +1
  You don't know that. You write it anyway, because someone at home needs to read it.
- { sick("sister"): -> healer }
-> END

=== healer ===
{ home("mother"):
  Under the last fold there's a line in smaller letters.
  "Asa's cough is no better. There's a healer in the next valley who knows winter fevers. She wants fifteen rings to come, and she says after that Asa will be well for the rest of the winter." # speaker: mother
- else:
  At the bottom there's a line about Asa's cough, which is no better, and a healer in the next valley who knows winter fevers. She wants fifteen rings to come, and says that afterwards Asa will be well for the rest of the winter.
}
* [Send the fifteen rings for the healer. #needs: rings 15]
  # fx: rings -15
  # fx: family sister well
  You send them tonight. The raven looks at the weight of the packet, and then at you, and goes.
* [Keep sending medicine instead.]
  You write that the medicine is working and you'll keep sending it. It will have to be enough.
- -> END
