# draft
// FIRST DRAFT (phase 6): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// The seeress's last night (docs/tech-spec.md §72). It changes nothing: the ending follows from the run.
EXTERNAL flag(name)
EXTERNAL home(id)
{ not home("heid"): -> gone }
You think of Heid in her warm corner, awake, because she'll have seen tonight coming longer than anyone.
{
- flag("heid_asked_end"):
  Badly for most, she said. Well for a few. She never said which few.
- flag("heid_asked_home"):
  She said it depended on you. You've tried not to think about that all day.
}
{ flag("heid_honest"):
  Up and down the valley, people are at home tonight with their children, because she told them the truth for nothing.
}
{ flag("heid_paid"):
  Your mother's pot is full tonight, and the steward's rings are in it.
}
* [Ask her, out loud, how it ends.]
  Nobody answers. Somewhere a long way off, an old woman laughs at you, fondly.
* [Don't ask.]
  You've asked enough of her. Tonight she can keep what she sees.
- The mist comes up from the battlefield and doesn't clear.
-> END

=== gone ===
You think of Heid, who would have seen tonight coming longer than anyone, and who went down to Hel before it came. She'll be sitting near the door of the hall, where she can see who comes in. She always liked to know first.
-> END
