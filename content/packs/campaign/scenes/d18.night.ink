# draft
// FIRST DRAFT (M7): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// Loki's last offer. With the deal kept and enough nails left long, Naglfar sails tonight (ending.naglfar).
EXTERNAL flag(name)
EXTERNAL home(id)
Loki is sitting on the end of your table in no borrowed face at all, only his own: thin, pleasant, and scarred across the lips.
"The last payday," he says. "I always come to the last of things. It's a weakness." # speaker: loki
"The ship's nearly finished. A few planks short. It's always a few planks short, until it isn't." # speaker: loki
{
- flag("loki_deal"):
  "You've kept your side, more or less. I've kept the names. They're chalked on the deck, where the rail will go." # speaker: loki
  "So. Are we still friends?" # speaker: loki
- else:
  "You've been very tidy with your clippers. Odin must be proud. He's never proud of anyone, so that's something." # speaker: loki
  "Once more, then, because I'm fond of you. When the ship sails, there's room aboard. Leave the last few nails long, and give me the names." # speaker: loki
}
{ flag("ulf_shipyard") && home("brother"):
  "Your brother did the rail. Lovely work. He doesn't know what it's for, and I haven't told him. I thought you'd rather." # speaker: loki
}
{ flag("covered_loki"):
  "You left me out of your report, once. I noticed. I notice everything that's left out." # speaker: loki
}
{ flag("reported_loki"):
  "You put my name in your report, once. Odin's people came up the path with torches. I was very flattered." # speaker: loki
}
{ flag("told_odin"):
  "And you told him. Of course you did. He came down to the gate in that hat, didn't he? He thinks nobody knows him in that hat." # speaker: loki
}
{ flag("lied_to_odin"):
  "You lied to him. To his face, such as it is. I could almost be proud of you." # speaker: loki
}
// The old woman at the desk on Day 15 (docs/tech-spec.md §59).
{
- flag("saw_thokk"):
  "You knew me in the shawl. Nobody ever knows me in the shawl. I've been in a good mood about it for three days." # speaker: loki
- flag("missed_thokk"):
  "An old woman stopped at your table three days ago and asked the way to Hel's bridge." He waits. "That was me. I thought you'd want to know." # speaker: loki
}
* { flag("loki_deal") } ["We're still friends."]
  # fx: standing loki +1
  "Good. I'd hate to rub the names out. Chalk smudges." # speaker: loki
  He pats your hand, the way he patted the dead woman's on your third night.
* { flag("loki_deal") } ["Rub the names out."]
  # fx: flag loki_deal = 0
  # fx: flag broke_loki
  # fx: standing loki -3
  # fx: standing odin +1
  He looks at you for a long time. For once he doesn't smile.
  "As you like." # speaker: loki
  He licks his thumb and makes a small wiping movement in the air, and that's all.
* { not flag("loki_deal") } [Give him the names.]
  # fx: flag loki_deal
  # fx: flag wood = 0
  # fx: flag ferryman = 0
  # fx: flag stay_home = 0
  # fx: standing loki +2
  You say them out loud. He repeats them back carefully, like a man learning a tune.
  "Better late. It's how I do most things." # speaker: loki
  Tonight you'll have to write home and tell them to go north instead. You start working out how to say it.
* { not flag("loki_deal") } ["No."]
  # fx: standing loki -1
  "No," he agrees. "You never did like me. Most people don't, at the end." # speaker: loki
  { flag("refused_loki"):
    "You said no on the nail day, too. I liked that. It's so rare to meet someone consistent." # speaker: loki
  }
- When you look up he's gone. Draupnir's eight rings are on the table where he sat. You count them twice, and there are eight both times, and you still don't trust it.
-> END
