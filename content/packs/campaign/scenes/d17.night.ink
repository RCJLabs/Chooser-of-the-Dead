# draft
// FIRST DRAFT (M7): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// The family's plan for Ragnarök. Each choice keeps one way out and drops the others, so the ending
// matches what you chose here (docs/story-drafts.md, "Endings").
EXTERNAL flag(name)
EXTERNAL home(id)
EXTERNAL rings()
Three days to the horn. Everyone at the gate knows it, the way you know rain is coming.
{
- home("mother"):
  // The day after you chose Ulf at the pass (docs/tech-spec.md §78), she writes about everything else.
  { flag("chose_ulf"):
    Your mother's letter is the longest she has ever sent. None of it is about Ulf. Most of it is about the weather and the goats. Then, at the very end, where the bark curls:
  - else:
    Your mother's letter is the longest she has ever sent. Most of it is about the weather, the goats and a neighbour's wedding. Then, at the very end, where the bark curls:
  }
  "Everyone is deciding where to be when it comes. I want us together. But I want you to tell me where." # speaker: mother
- home("brother"):
  Ulf's letter is short and very square.
  "Everyone is deciding where to be when it comes. You see the dead. You know more than we do. Tell me where to take them." # speaker: ulf
  { flag("ulf_shipyard"):
    "The ship's nearly done. There's room aboard for all of us, the foreman says. He says you'll know what he means." # speaker: ulf
  }
- else:
  Your aunt writes for Asa, who has drawn you at the bottom, with wings. Everyone in the valley is deciding where to be when it comes. Where should Asa be?
}
{ flag("ulf_shipyard") && home("brother") && home("mother"):
  Folded inside is a scrap from Ulf, in the north.
  "The ship's nearly done. There's room aboard for all of us, the foreman says. He says you'll know what he means." # speaker: ulf
}
{ flag("letters_honest") > flag("letters_kind"):
  Your letters home have always told them the truth, even when it cost. They'll believe this one.
}
{ flag("letters_kind") > flag("letters_honest"):
  Your letters home have always said that all was well. You wonder whether they'll believe this one.
}
You sit with it until the lamp burns low.
* { flag("loki_deal") || (flag("ulf_shipyard") && home("brother")) } [The ship.]
  # fx: flag loki_deal
  # fx: flag ferryman = 0
  You write that they should go north, to the ship, when it's time. You don't write what it's made of. They'll see.
* { flag("ferryman") } [The ferry.]
  # fx: flag loki_deal = 0
  You write that they should be at the mouth of the fjord when the horn blows, with warm clothes and the hundred rings you'll send. A hundred rings. You count what you have, and then count it again, as if it might have changed.
* { not flag("ferryman") } [The ferry. Send twenty rings for a place. #needs: rings 20]
  # fx: rings -20
  # fx: flag ferryman
  # fx: flag loki_deal = 0
  You wrap twenty rings in your answer for a place on the ferry, and write that there'll be a hundred more on the day.
  { flag("ferryman_doubted"):
    You told them to wait, the first time. The raven comes back before the lamp is out, with a scrap of bark in a hand you don't know. One word: "Finally."
  }
* { flag("wood_known") } [Hoddmímir's wood.]
  # fx: flag wood
  # fx: flag loki_deal = 0
  # fx: flag ferryman = 0
  You write that there's a wood in the hills where nothing can find you, and that they should go there and wait, and not come out until everything is green. You don't know if you believe it. You write it as if you do.
* [Home, together.]
  # fx: flag stay_home
  # fx: flag loki_deal = 0
  # fx: flag ferryman = 0
  You write that they should stay home, bank up the fire and stay together. Whatever comes can knock.
- The raven waits while you seal it. Then it's gone, and you sit a while longer with your hands flat on the table, the way you do before a stamp.
-> END
