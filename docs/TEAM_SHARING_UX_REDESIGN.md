# Team & Sharing — UX Redesign Spec

**Status**: Items 1 to 4 shipped in `v2.169.0` (2026-08-26). Items 5 to 10 remain proposed. Written against `v2.168.0`.
**Scope**: Team creation, member invitation, and folder sharing across the dashboard. Extension and mobile inherit the indicator vocabulary only.
**Reference model**: Google Drive's sharing system.

---

## 0. Why the current UX confuses people

Three findings, each traced to code. Two of them are structural, not cosmetic.

### 0.1 You cannot create a team

There is no create path anywhere in the product. `orgApi` exposes `getActiveOrg`, `listMembers`, `setCover`, `uploadCover`. Every organization that exists was created by hand in a migration (`20260607010000_phase_b_b1_leibtour_org.sql`, `20260621000000_add_valentina_to_leibtour_org.sql`).

It cannot be fixed in the client alone. Two RLS policies block it:

| Policy | Effect |
| --- | --- |
| `org_insert` | Any authenticated user may insert an `organizations` row (`created_by = auth.uid()`). |
| `orgmem_write` | Requires `app.org_role(organization_id) = 'admin'`, which is `NULL` for an org with zero members. |

So a client-side create would produce an organization its creator cannot join, and then cannot see (`org_select` requires `is_org_member`). **Creating a team needs a `SECURITY DEFINER` RPC.** See §5.1.

### 0.2 `/team` with no team is a dead end

`TeamPage` renders `TeamSharingGuide` when nothing is shared. Step 2 of that guide says "Hit Share on the folder". Following it opens `FolderShareModal`, which reports:

> You're not part of a team yet. Folder sharing becomes available once you belong to an organization.

No CTA. The guide instructs an action whose only outcome is a wall.

### 0.3 Sharing status is invisible where the items are

- The only indicator in the product is `FolderShareBadge` in the folder rail: a globe for team-wide, a people glyph for specific teammates, and **nothing at all for private**. Absence is the weakest available signal.
- `SnippetsTable` rows and `PromptCard` carry no sharing indication whatsoever. An item's access is decided entirely by its folder, and the item never says which folder rule governs it.
- The Prompts page has **no share entry point**. No rail, no context menu, no button. Prompt folder chips render `FolderShareBadge` but nothing can act on it. Sharing a prompt requires navigating to the Snippets page and sharing the folder from there.

### 0.4 Two supporting problems

**Sharing has an unstated side effect.** `permissionsApi.shareFolder` stamps `organization_id` on the folder and on every snippet and prompt inside it. `unshareFolderIfLastGrant` reverts it when the last grant goes. Neither is mentioned in the UI.

**One role description is wrong.** `InviteMemberPanel` describes Manager as "Can invite people and share folders". `FolderShareModal.canManage` is `folder.user_id === currentUserId || activeOrg?.myRole === 'admin'` — a manager has no more sharing power than a member. The copy promises authority the code does not grant.

---

## 1. The access states, stated honestly

The brief asks for Private / Team-shared / Public. **Public does not exist in SprintBrain and cannot be shown without lying to the user.** There is no anonymous read path: `20260819000000_revoke_anon_table_grants.sql` revoked anon table grants, every read is RLS-scoped to `auth.uid()`, and no share tokens or public URLs exist.

The three real states map cleanly onto Drive anyway:

| SprintBrain state | Drive equivalent | Mechanism |
| --- | --- | --- |
| **Private** | Restricted, owner only | No `folder_permissions` row. `organization_id` is `NULL`. |
| **Specific people** | Restricted + named people | One or more `principal_type='user'` grants. |
| **Whole team** | "Anyone at Acme Ltd" | A `principal_type='organization'` grant. |
| *(not built)* | Anyone with the link | Would need an anon read path, share tokens, and a revocation model. |

If public link sharing is ever wanted, it is a security project, not a badge. Scope it separately.

---

## 2. Flow A — Create a team

### 2.1 Entry points

Three, because a person hits this need from three different places:

1. `/team` with no organization. The page becomes the create screen instead of the guide.
2. Any share control, with no organization. An inline first step inside the same modal, never a wall.
3. Settings, in a Team section.

### 2.2 The flow

One screen. No wizard: Drive does not wizard you into a shared drive, you name it and you are in.

```
┌─────────────────────────────────────────────────┐
│  TEAM                                           │
│  Create your team                               │
│  A team is where shared folders live.           │
│  You can invite people right after.             │
│                                                 │
│  Team name                                      │
│  ┌───────────────────────────────────────────┐  │
│  │ Club Automotive                           │  │
│  └───────────────────────────────────────────┘  │
│  You can rename it later.                       │
│                                                 │
│  ┌─────────────┐                                │
│  │ Create team │                                │
│  └─────────────┘                                │
│                                                 │
│  Were you invited to a team? Check your         │
│  invitations.                                   │
└─────────────────────────────────────────────────┘
```

**Name prefill**: `user_metadata.company_name` if set, else empty with placeholder `Acme Ltd`. The email-domain fallback was dropped during implementation: it needs a hardcoded free-provider blocklist, which rots, and it guesses wrong for anyone on a personal address. An empty field with a clear placeholder costs one line of typing and never guesses.

**On success**: land on `/team`. The roster shows the creator as Admin. The invite field is auto-focused. One toast: `Team created. You're the admin.`

**The "Check your invitations" link matters.** Someone who was invited but never opened the email will otherwise create a duplicate team and never find their colleagues.

### 2.3 Constraint: one team per account

The DB supports multi-org membership, but `getActiveOrg` takes the earliest membership and there is no org switcher, so a second team would be invisible. The RPC must reject it rather than create something the user cannot reach.

Error copy: `You're already in Club Automotive. One team per account for now.`

---

## 3. Flow B — Invite members

The underlying mechanics are sound and need no rework: server-side send (the dashboard client is PKCE, so a link minted in the inviter's browser is unopenable in anyone else's), email-matched acceptance with no token in the URL, accept/decline, resend, withdraw, and a standing `PendingInviteBanner`. Four UX changes.

### 3.1 Multi-email input

Today: one address per send. Change to a chip input that accepts comma, space, or newline separated addresses and loops `invitationsApi.send`, reporting per-address outcomes.

```
Invite people to Club Automotive
┌──────────────────────────────────────────────────┐
│ [marco@clubauto.it ×] [sara@clubauto.it ×] |     │
└──────────────────────────────────────────────────┘
Join as  ( Member )( Manager )( Admin )     [ Send invites ]
Uses everything shared with them. Can share folders they own.
```

Mixed results report per address, never a single generic failure:
`2 invitations sent. marco@clubauto.it is already in your team.`

### 3.2 Pending members belong in the roster

Today invitations live in a separate list below the roster, so the roster undercounts the team and "who is on this team" has two answers. Put pending people **in** the roster, at 60% opacity, with an `Invited` chip and inline resend / withdraw. Drive shows pending shares in the people list for the same reason.

### 3.3 Show the capability to people who lack it

`InviteMemberPanel` renders only for admins and managers. A member sees no trace that invitations exist and concludes the product cannot do it. Show the panel disabled, with the reason:

> Only admins and managers can invite people. Ask Valentina.

### 3.4 Role copy, corrected

Rewritten to describe sharing power, since that is what the chooser is actually deciding. The Manager line is a correction, not a rewording (§0.4).

| Role | Copy |
| --- | --- |
| Member | Uses everything shared with them. Can share folders they own. |
| Manager | Everything a member can do, plus inviting people. |
| Admin | Full control. Can manage sharing on every folder in the team, including folders they don't own. |

The Admin line is the one nobody has been told. It is true today (`app.folder_level` returns `owner` to any org admin before it looks at a single grant) and it needs to be visible before someone shares a folder, not discovered afterwards.

---

## 4. Flow C — Share snippets and prompts

### 4.1 The rule the UI must teach

**The folder is the unit of sharing.** The product enforces this; the UI hides it. Fix by giving items a Share control that opens the *folder's* share sheet with an explicit banner, rather than pretending items share individually or offering nothing at all.

### 4.2 The share sheet, Drive-shaped

Five blocks, top to bottom. Blocks 2 and 4 are the substantive changes.

```
┌───────────────────────────────────────────────────────┐
│ Share "Client replies"                            ✕   │
│ 12 snippets · 3 prompts. Everyone here gets all of    │
│ them.                                                 │
├───────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐ │
│ │ Add teammates by name or email                    │ │
│ └───────────────────────────────────────────────────┘ │
│                          ( Can use ▾ )   [ Send ]     │
├───────────────────────────────────────────────────────┤
│ PEOPLE WITH ACCESS                                    │
│ ● Valentina (you)                     Owner           │
│ ● Team admins                  Full control  ⓘ        │
│ ● Marco Rossi                  ( Can use ▾ )   🗑      │
│   Shared by you · 3 days ago                          │
├───────────────────────────────────────────────────────┤
│ GENERAL ACCESS                                        │
│ 🔒 ( Private ▾ )                                      │
│    Only you and the people you add                    │
├───────────────────────────────────────────────────────┤
│ Sharing moves this folder and its 15 items into Club  │
│ Automotive. Team admins can see and manage them.      │
│ Remove all access to make it private again.           │
│                                          [ Done ]     │
└───────────────────────────────────────────────────────┘
```

**Block 2 — batch add.** Today's modal grants one principal per action; inviting three people to a folder is three separate share operations. Chips plus one role select for the batch, matching Drive.

**Block 3 — people with access.** Keeps the existing provenance line (`Shared by Maria · 3 days ago`), which is better than Drive's. Adds two pinned, non-removable rows: the owner, and `Team admins · Full control` with a tooltip explaining §3.4's admin rule. Showing that row is what converts a surprise into a stated policy.

**Block 4 — general access.** The single most valuable addition. One dropdown carrying the private / whole-team decision, exactly Drive's "General access" control, with a role select beside the team option. Today that distinction is implicit in which principal you happened to pick from a list.

**Block 5 — consequence strip.** Shown only on the first share of a still-personal folder. States the `organization_id` stamp, the admin visibility, and the fact that it reverts.

### 4.3 Sharing prompts

The Prompts page gets a share affordance: a kebab on `PromptCard` → `Share folder…`, and the folder chips become clickable to open the same sheet.

For an item in no folder, offer the fix instead of the refusal:

> Sharing works by folder. Put "Refund reply" in a folder to share it.
> ( Choose a folder ▾ )  ( New folder )

---

## 5. Visual indicator system

One vocabulary. Every surface uses the same glyph, the same words, the same meaning.

| State | Glyph | Chip | Tooltip |
| --- | --- | --- | --- |
| **Private** | `Lock` 14 px, `ink-subtle` | none, glyph only | Private. Only you. |
| **Specific people** | `Users` + count | `bg-alt` / `ink-muted`, pill | Shared with 3 teammates |
| **Whole team** | `Globe` | `primary-bg` / `primary`, 1 px `primary-bdr`, pill | Everyone in Club Automotive can use this |

No new tokens. Every value above already exists in `docs/DESIGN_SYSTEM.md`.

Four changes from what ships today:

1. **Private gets a glyph.** Absence of a badge has never taught anyone anything.
2. **Items inherit their folder's badge**, rendered at reduced opacity, tooltip `Shared because it's in Client replies`. This is Drive's inherited-share convention and it closes §0.3.
3. **Folders shared with you carry the owner's avatar** on the row. SprintBrain has no separate "Shared with me" location, so the signal moves to the row. Reuses the existing `Avatar`.
4. **The badge becomes a button.** Clicking it opens the share sheet. Drive's chip is clickable; today's is inert decoration.

---

## 6. Microcopy deck

### Buttons

| Context | Label |
| --- | --- |
| Create the org | `Create team` |
| Send invitations | `Send invites` |
| Open share sheet, may manage | `Share` |
| Open share sheet, read only | `View access` |
| Close share sheet | `Done` |
| Remove one grant | `Remove` |
| Item with no folder | `Choose a folder` / `New folder` |

### Status labels

| State | Label |
| --- | --- |
| Folder, no grants | `Private` |
| Folder, user grants | `Shared with 3` |
| Folder, org grant | `Whole team` |
| Member, accepted | *(role name)* |
| Member, invitation open | `Invited` |
| Invitation declined | `Declined` |
| Invitation expired | `Expired` |

### Access levels

Keep the existing labels. They are already plain and already shipped.

| Level | Label | Help |
| --- | --- | --- |
| `view` | Can use | Can use everything in this folder |
| `edit` | Can edit | Can use and edit the items inside |
| `owner` | Full control | Full control, including sharing |

### Empty states

| Screen | Copy |
| --- | --- |
| `/team`, no org | **Create your team** / A team is where shared folders live. You can invite people right after. |
| `/team`, org but nothing shared | **Nothing shared yet** / Share a folder and everyone you pick gets its snippets and prompts in their extension straight away. |
| Share sheet, no grants | **Private to you** / Nobody else can see this folder. |
| `/team` search, no hits | **No shared items match** / Try a different name or trigger. |

### Toasts

| Event | Copy |
| --- | --- |
| Team created | `Team created. You're the admin.` |
| Invites sent | `2 invitations sent.` |
| Partial send | `2 invitations sent. marco@clubauto.it is already in your team.` |
| Shared | `Shared with Marco. It's in their extension now.` |
| Access removed | `Marco no longer has access.` |
| Last grant removed | `Client replies is private again.` |

### Errors

Every error says what happened and what to do next.

| Condition | Copy |
| --- | --- |
| Second team attempt | `You're already in Club Automotive. One team per account for now.` |
| Non-admin edits cover | `Only a team admin can change the cover.` |
| Non-owner opens share | `Only the folder owner or a team admin can change sharing.` |
| Manager invites an admin | `Only an admin can invite someone as an admin.` |
| Invite own address | `That's your own address, you're already in this team.` |
| Invitation email failed | `Invitation saved, but the email didn't go out. Send it again, or tell them to check /invite.` |

---

## 7. Permissions, reconciled

Two ladders exist and no screen has ever explained how they interact.

**Org role** (`organization_members.role`) governs the team.
**Folder level** (`folder_permissions.level`) governs one folder.

| | Invite people | Share a folder they own | Share any team folder | Read every team folder |
| --- | --- | --- | --- | --- |
| **Member** | no | yes | no | no |
| **Manager** | yes | yes | no | no |
| **Admin** | yes | yes | **yes** | **yes** |

The admin row is a consequence of `app.folder_level`: it returns `owner` when `app.org_role(v_org) = 'admin'`, before it reads any grant. This is correct behaviour for an admin role, and it is invisible in the product today. §4.2 block 3 makes it visible.

---

## 8. Edge cases

| # | Case | Today | Resolution |
| --- | --- | --- | --- |
| 1 | Org admin holds `owner` on every org folder | True, undocumented, reads as a leak | Pinned `Team admins · Full control` row in the share sheet, with tooltip |
| 2 | Manager copy overpromises | `ROLE_HELP.manager` claims folder-sharing power it lacks | Corrected copy, §3.4 |
| 3 | Last grant removed | Folder silently leaves the org (`unshareFolderIfLastGrant`) | Confirm: `Remove the last person? The folder goes back to private and leaves Club Automotive.` |
| 4 | User has no team | Dead-end guide | `/team` becomes the create screen; every share entry offers create inline |
| 5 | Invited but never accepted | Banner exists; roster hides them | Pending rows in the roster, §3.2 |
| 6 | Declined or expired invite | Listed, no recovery action | One-click `Invite again` on both |
| 7 | Second team | Would be created and be invisible | RPC rejects with a named error, §2.3 |
| 8 | Leaving a team / removing a member | **Not built** | See §9. Do not ship a half-answer |
| 9 | Deleting a shared folder holding a teammate's items | **Broken.** See below | Reassign all items in the folder, not only the caller's |

### 8.9 in detail

`foldersApi.deleteFolder` reassigns items with `.eq('user_id', userId)`, so it only ever moves the caller's own rows out of the folder. The FK behaviour then diverges by table (verified against the live database, 2026-08-26):

| FK | On folder delete |
| --- | --- |
| `snippets.folder_id` | `SET NULL` |
| `prompts.folder_id` | `NO ACTION` |
| `folder_permissions.folder_id` | `CASCADE` |

So an admin deleting a shared folder that holds a teammate's **snippet** silently detaches it, and one that holds a teammate's **prompt** fails with a raw foreign-key violation surfaced as a generic error.

Fix: reassign every item in the folder, not just the caller's, then confirm with
`Delete "Client replies"? Its 15 items stay in their owners' libraries and stop being shared.`

---

## 9. Build cost

Ordered by dependency. Nothing after item 1 is reachable without item 1.

| # | Work | Surface | Notes |
| --- | --- | --- | --- |
| 1 | ✅ **Shipped v2.169.0.** `create_team(p_name text) returns uuid` | Migration | `SECURITY DEFINER`. Inserts org + creator-as-admin atomically. Rejects a caller who already has a membership. **Blocks everything else.** |
| 2 | ✅ **Shipped v2.169.0.** `orgApi.createTeam` + `orgStore.createTeam` | `app/src/lib/api/orgApi.ts`, `stores/orgStore.ts` | |
| 3 | ✅ **Shipped v2.169.0.** `CreateTeamPanel` + the no-org branch of `TeamPage` | `features/org/` | Replaces the dead end |
| 4 | ✅ **Shipped v2.169.0.** Inline create inside `FolderShareModal` | `features/org/FolderShareModal.tsx` | Removes the wall |
| 5 | Share sheet rebuild: batch add, general access, consequence strip, admin row | `features/org/FolderShareModal.tsx` | The largest single component change |
| 6 | Multi-email invite + pending-in-roster + disabled-with-reason + role copy | `features/org/InviteMemberPanel.tsx`, `routes/TeamPage.tsx` | |
| 7 | Indicator system: private glyph, inherited item badges, owner avatars, clickable badge | `features/org/FolderTree.tsx`, `features/snippets/SnippetsTable.tsx`, `features/prompts/PromptCard.tsx` | Extract `ShareBadge` to `components/shared/` |
| 8 | Prompts page share entry | `routes/PromptsPage.tsx`, `features/prompts/PromptCard.tsx` | |
| 9 | Folder-delete fix + confirm copy | `lib/api/foldersApi.ts` | Bug fix, §8.9. Independent of the rest |
| 10 | Member removal / leaving a team | Migration + UI | **Out of scope here.** Needs its own spec: grant cleanup and `organization_id` reversion for the departing member's assets |

Items 1 to 4 removed the dead ends and shipped in v2.169.0. Items 5 to 8 remove the ambiguity. Item 9 is a bug fix that can ship on its own. Item 10 is the next spec.
