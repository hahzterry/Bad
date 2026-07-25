use anchor_lang::prelude::*;
// ── Private messaging (MagicBlock TEE / Private Ephemeral Rollups) ──
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{EphemeralMembersArgs, EphemeralPermission, Member, PERMISSION_SEED};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

declare_id!("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");

pub const PROFILE_SEED: &[u8] = b"profile";
pub const POST_SEED: &[u8] = b"post";
pub const CHAT_SEED: &[u8] = b"chat";
pub const MESSAGE_SEED: &[u8] = b"message";
pub const FOLLOW_SEED: &[u8] = b"follow";
pub const COMMENT_SEED: &[u8] = b"comment";
pub const REACTION_SEED: &[u8] = b"reaction";
pub const COMMUNITY_SEED: &[u8] = b"community";
pub const MEMBERSHIP_SEED: &[u8] = b"membership";
pub const POLL_SEED: &[u8] = b"poll";
pub const POLL_VOTE_SEED: &[u8] = b"poll_vote";
pub const LIKE_SEED: &[u8] = b"like";

/// Hardcoded treasury wallet — ALL rent refunds MUST go here.
pub const TREASURY_PUBKEY: Pubkey = pubkey!("4tpjCdXS1fKiYoBYLvTNNyHwzTAhuigB3TY6Wd2QbxT9");

/// Max members on a private-chat permission (the 2 participants; capped for rent).
pub const MAX_PERMISSION_MEMBERS: usize = 4;

// Private inbox (MagicBlock TEE) — a fixed-size delegated ring buffer of recent
// messages. Appending MUTATES the delegated account (works in the ER), unlike
// creating a new account per message (which the rollup rejects).
pub const INBOX_SEED: &[u8] = b"inbox";
pub const INBOX_CAP: usize = 30;        // recent messages kept
pub const INBOX_MSG_MAX: usize = 200;   // max content bytes per message

#[ephemeral]
#[program]
pub mod shadowspace {
    use super::*;

    // ========== PROFILE ==========

    pub fn create_profile(
        ctx: Context<CreateProfile>,
        username: String,
        display_name: String,
        bio: String,
    ) -> Result<()> {
        let profile = &mut ctx.accounts.profile;
        // Prevent re-initialization — created_at == 0 means fresh account
        require!(profile.created_at == 0, ShadowError::AlreadyInitialized);
        profile.owner = ctx.accounts.user.key();
        profile.username = username;
        profile.display_name = display_name;
        profile.bio = bio;
        profile.is_private = false;
        profile.post_count = 0;
        profile.follower_count = 0;
        profile.following_count = 0;
        profile.active_conversation_count = 0;
        profile.avatar_url = String::new();
        profile.banner_url = String::new();
        profile.created_at = Clock::get()?.unix_timestamp;
        msg!("Profile created for {}", profile.owner);
        Ok(())
    }

    /// Resize an existing profile account to the current schema size.
    /// This is needed when the Profile struct grows (e.g. adding follower/following counts).
    pub fn migrate_profile(ctx: Context<MigrateProfile>) -> Result<()> {
        let profile = &mut ctx.accounts.profile;
        // If follower_count / following_count were uninitialised (old schema),
        // they'll deserialise as 0 after realloc, which is correct.
        msg!("Profile migrated for {}, new size {}", profile.owner, 8 + Profile::LEN);
        Ok(())
    }

    pub fn update_profile(
        ctx: Context<UpdateProfile>,
        display_name: String,
        bio: String,
        avatar_url: String,
        banner_url: String,
        website_url: String,
    ) -> Result<()> {
        require!(display_name.len() <= 24, ShadowError::ContentTooLong);
        require!(bio.len() <= 64, ShadowError::ContentTooLong);
        require!(avatar_url.len() <= 128, ShadowError::ContentTooLong);
        require!(banner_url.len() <= 128, ShadowError::ContentTooLong);
        require!(website_url.len() <= 64, ShadowError::ContentTooLong);
        let profile = &mut ctx.accounts.profile;
        profile.display_name = display_name;
        profile.bio = bio;
        profile.avatar_url = avatar_url;
        profile.banner_url = banner_url;
        let _ = website_url;
        msg!("Profile updated for {}", profile.owner);
        Ok(())
    }

    // ========== POSTS ==========

    pub fn create_post(
        ctx: Context<CreatePost>,
        post_id: u64,
        content: String,
        is_private: bool,
    ) -> Result<()> {
        require!(content.len() <= 500, ShadowError::ContentTooLong);
        let post = &mut ctx.accounts.post;
        // Prevent re-initialization — don't overwrite existing posts
        require!(post.created_at == 0, ShadowError::AlreadyInitialized);
        post.author = ctx.accounts.profile.owner;
        post.post_id = post_id;
        post.content = content;
        post.is_private = is_private;
        post.likes = 0;
        post.comment_count = 0;
        post.created_at = Clock::get()?.unix_timestamp;
        let profile = &mut ctx.accounts.profile;
        profile.post_count += 1;
        msg!("Post {} created, private={}", post_id, is_private);
        Ok(())
    }

    pub fn edit_post(
        ctx: Context<EditPost>,
        _post_id: u64,
        new_content: String,
    ) -> Result<()> {
        require!(new_content.len() <= 500, ShadowError::ContentTooLong);
        let post = &mut ctx.accounts.post;
        post.content = new_content;
        post.updated_at = Clock::get()?.unix_timestamp;
        msg!("Post {} edited by {}", post.post_id, post.author);
        Ok(())
    }

    pub fn like_post(ctx: Context<LikePost>, _post_id: u64) -> Result<()> {
        // Record the like — PDA uniqueness via `init` prevents double-liking
        let like_record = &mut ctx.accounts.like_record;
        like_record.post = ctx.accounts.post.key();
        like_record.liker = ctx.accounts.user.key();
        like_record.liked_at = Clock::get()?.unix_timestamp;

        let post = &mut ctx.accounts.post;
        post.likes += 1;
        msg!("Post {} liked by {}, total: {}", post.post_id, like_record.liker, post.likes);
        Ok(())
    }

    pub fn create_comment(
        ctx: Context<CreateComment>,
        _post_id: u64,
        comment_index: u64,
        content: String,
    ) -> Result<()> {
        require!(content.len() <= 100, ShadowError::ContentTooLong);
        let comment = &mut ctx.accounts.comment;
        // Prevent re-initialization — don't overwrite existing comments
        require!(comment.created_at == 0, ShadowError::AlreadyInitialized);
        comment.post = ctx.accounts.post.key();
        comment.author = ctx.accounts.commenter_profile.owner;
        comment.comment_index = comment_index;
        comment.content = content;
        comment.created_at = Clock::get()?.unix_timestamp;
        let post = &mut ctx.accounts.post;
        post.comment_count += 1;
        msg!("Comment {} on post {}", comment_index, post.post_id);
        Ok(())
    }

    pub fn react_to_post(
        ctx: Context<ReactToPost>,
        _post_id: u64,
        reaction_type: u8,
    ) -> Result<()> {
        // Validate reaction_type is within allowed range (0-5 = 6 reactions)
        require!(reaction_type <= 5, ShadowError::InvalidReactionType);
        let reaction = &mut ctx.accounts.reaction;
        reaction.post = ctx.accounts.post.key();
        reaction.user = ctx.accounts.reactor_profile.owner;
        reaction.reaction_type = reaction_type;
        msg!("Reaction {} on post {}", reaction_type, _post_id);
        Ok(())
    }

    // ========== LEGACY CHAT (kept for backwards compat) ==========

    pub fn create_chat(ctx: Context<CreateChat>, chat_id: u64) -> Result<()> {
        let chat = &mut ctx.accounts.chat;
        // Prevent re-initialization
        require!(chat.created_at == 0, ShadowError::AlreadyInitialized);
        // Both participants must be different wallets
        require!(ctx.accounts.user1.key() != ctx.accounts.user2.key(), ShadowError::CannotFollowSelf);
        chat.chat_id = chat_id;
        chat.user1 = ctx.accounts.user1.key();
        chat.user2 = ctx.accounts.user2.key();
        chat.message_count = 0;
        chat.created_at = Clock::get()?.unix_timestamp;
        msg!("Chat {} created", chat_id);
        Ok(())
    }

    pub fn send_message(
        ctx: Context<SendMessage>,
        chat_id: u64,
        message_index: u64,
        content: String,
        is_payment: bool,
        payment_amount: u64,
    ) -> Result<()> {
        let message = &mut ctx.accounts.message;
        // Prevent re-initialization — don't overwrite existing messages
        require!(message.timestamp == 0, ShadowError::AlreadyInitialized);
        message.chat_id = chat_id;
        message.sender = ctx.accounts.sender.key();
        message.content = content;
        message.is_payment = is_payment;
        message.payment_amount = payment_amount;
        message.timestamp = Clock::get()?.unix_timestamp;
        message.message_index = message_index;
        let chat = &mut ctx.accounts.chat;
        chat.message_count += 1;
        msg!("Message sent in chat {}", chat_id);
        Ok(())
    }

    // ========== COMMUNITIES ==========

    pub fn create_community(
        ctx: Context<CreateCommunity>,
        community_id: u64,
        name: String,
        description: String,
        avatar_url: String,
    ) -> Result<()> {
        require!(name.len() <= 32, ShadowError::ContentTooLong);
        require!(description.len() <= 128, ShadowError::ContentTooLong);
        require!(avatar_url.len() <= 128, ShadowError::ContentTooLong);
        let community = &mut ctx.accounts.community;
        community.creator = ctx.accounts.creator_profile.owner;
        community.community_id = community_id;
        community.name = name;
        community.description = description;
        community.avatar_url = avatar_url;
        community.member_count = 1; // creator auto-joins
        community.created_at = Clock::get()?.unix_timestamp;
        msg!("Community {} created by {}", community.community_id, community.creator);
        Ok(())
    }

    pub fn join_community(ctx: Context<JoinCommunity>, _community_id: u64) -> Result<()> {
        let community = &mut ctx.accounts.community;
        require!(community.member_count < 100, ShadowError::CommunityFull);
        let community_key = community.key();
        community.member_count += 1;
        let membership = &mut ctx.accounts.membership;
        membership.community = community_key;
        membership.member = ctx.accounts.member_profile.owner;
        membership.joined_at = Clock::get()?.unix_timestamp;
        msg!("{} joined community {}", membership.member, _community_id);
        Ok(())
    }

    pub fn leave_community(ctx: Context<LeaveCommunity>, _community_id: u64) -> Result<()> {
        let community = &mut ctx.accounts.community;
        community.member_count = community.member_count.saturating_sub(1);
        msg!("{} left community {}", ctx.accounts.member_profile.owner, community.community_id);
        Ok(())
    }

    pub fn update_community(
        ctx: Context<UpdateCommunity>,
        _community_id: u64,
        description: String,
        avatar_url: String,
    ) -> Result<()> {
        require!(description.len() <= 128, ShadowError::ContentTooLong);
        require!(avatar_url.len() <= 128, ShadowError::ContentTooLong);
        let community = &mut ctx.accounts.community;
        community.description = description;
        community.avatar_url = avatar_url;
        msg!("Community {} updated", community.community_id);
        Ok(())
    }

    pub fn close_community(ctx: Context<CloseCommunity>, _community_id: u64) -> Result<()> {
        msg!("Community {} closed by creator", ctx.accounts.community.community_id);
        Ok(())
    }

    // ========== POLLS / VOTING ==========

    pub fn create_poll(
        ctx: Context<CreatePoll>,
        poll_id: u64,
        question: String,
        option_a: String,
        option_b: String,
        option_c: String,
        option_d: String,
        num_options: u8,
        ends_at: i64,
    ) -> Result<()> {
        require!(question.len() <= 200, ShadowError::ContentTooLong);
        require!(option_a.len() <= 50, ShadowError::ContentTooLong);
        require!(option_b.len() <= 50, ShadowError::ContentTooLong);
        require!(option_c.len() <= 50, ShadowError::ContentTooLong);
        require!(option_d.len() <= 50, ShadowError::ContentTooLong);
        require!(num_options >= 2 && num_options <= 4, ShadowError::InvalidPollOptions);

        let now = Clock::get()?.unix_timestamp;
        require!(ends_at > now, ShadowError::PollAlreadyEnded);
        // Cap poll duration at 30 days to prevent indefinite polls
        require!(ends_at <= now + 30 * 24 * 60 * 60, ShadowError::PollAlreadyEnded);

        let poll = &mut ctx.accounts.poll;

        poll.creator = ctx.accounts.profile.owner;
        poll.poll_id = poll_id;
        poll.question = question;
        poll.option_a = option_a;
        poll.option_b = option_b;
        poll.option_c = option_c;
        poll.option_d = option_d;
        poll.num_options = num_options;
        poll.votes_a = 0;
        poll.votes_b = 0;
        poll.votes_c = 0;
        poll.votes_d = 0;
        poll.total_votes = 0;
        poll.ends_at = ends_at;
        poll.is_closed = false;
        poll.created_at = now;

        msg!("Poll {} created: {} options, ends at {}", poll_id, num_options, ends_at);
        Ok(())
    }

    pub fn vote_poll(
        ctx: Context<VotePoll>,
        _poll_id: u64,
        choice: u8,
    ) -> Result<()> {
        let poll_key = ctx.accounts.poll.key();
        let voter = ctx.accounts.voter_profile.owner;
        let poll = &mut ctx.accounts.poll;
        let now = Clock::get()?.unix_timestamp;

        // Check poll is still active
        require!(!poll.is_closed, ShadowError::PollAlreadyEnded);
        require!(now < poll.ends_at, ShadowError::PollAlreadyEnded);
        require!(choice < poll.num_options, ShadowError::InvalidPollChoice);

        // Record the vote (PDA uniqueness via init prevents double-voting)
        let vote = &mut ctx.accounts.poll_vote;

        vote.poll = poll_key;
        vote.voter = voter;
        vote.choice = choice;
        vote.voted_at = now;

        // Increment vote count
        match choice {
            0 => poll.votes_a += 1,
            1 => poll.votes_b += 1,
            2 => poll.votes_c += 1,
            3 => poll.votes_d += 1,
            _ => return Err(ShadowError::InvalidPollChoice.into()),
        }
        poll.total_votes += 1;

        msg!("Vote cast on poll {}: option {}, total votes {}", poll.poll_id, choice, poll.total_votes);
        Ok(())
    }

    pub fn close_poll(ctx: Context<ClosePoll>, _poll_id: u64) -> Result<()> {
        let poll = &mut ctx.accounts.poll;
        poll.is_closed = true;
        msg!("Poll {} closed by creator. Final votes: A={} B={} C={} D={} total={}",
            poll.poll_id, poll.votes_a, poll.votes_b, poll.votes_c, poll.votes_d, poll.total_votes);
        Ok(())
    }

    // ========== FOLLOW ==========

    pub fn follow_user(ctx: Context<FollowUser>) -> Result<()> {
        let follow = &mut ctx.accounts.follow_account;
        follow.follower = ctx.accounts.follower_profile.owner;
        follow.following = ctx.accounts.following_profile.owner;

        let follower_profile = &mut ctx.accounts.follower_profile;
        follower_profile.following_count += 1;
        let following_profile = &mut ctx.accounts.following_profile;
        following_profile.follower_count += 1;

        msg!("{} followed {}", follow.follower, follow.following);
        Ok(())
    }

    pub fn unfollow_user(ctx: Context<UnfollowUser>) -> Result<()> {
        let follower_profile = &mut ctx.accounts.follower_profile;
        follower_profile.following_count = follower_profile.following_count.saturating_sub(1);
        let following_profile = &mut ctx.accounts.following_profile;
        following_profile.follower_count = following_profile.follower_count.saturating_sub(1);

        msg!("{} unfollowed {}", follower_profile.owner, following_profile.owner);
        Ok(())
    }

    // ========== CLOSE ACCOUNTS (reclaim rent) ==========

    /// Close a profile account and return rent to the owner
    pub fn close_profile(ctx: Context<CloseProfile>) -> Result<()> {
        msg!("Profile closed for {}", ctx.accounts.profile.owner);
        Ok(())
    }

    /// Close a post account and return rent to the author
    pub fn close_post(ctx: Context<ClosePost>, _post_id: u64) -> Result<()> {
        let profile = &mut ctx.accounts.profile;
        profile.post_count = profile.post_count.saturating_sub(1);
        msg!("Post closed");
        Ok(())
    }

    /// Close a comment account and return rent
    pub fn close_comment(ctx: Context<CloseComment>, _post_id: u64, _comment_index: u64) -> Result<()> {
        let post = &mut ctx.accounts.post;
        post.comment_count = post.comment_count.saturating_sub(1);
        msg!("Comment closed");
        Ok(())
    }

    /// Close a reaction account and return rent
    pub fn close_reaction(_ctx: Context<CloseReaction>, _post_id: u64) -> Result<()> {
        msg!("Reaction closed");
        Ok(())
    }

    /// Close a legacy chat account and return rent
    pub fn close_chat(_ctx: Context<CloseChat>, _chat_id: u64) -> Result<()> {
        msg!("Chat closed");
        Ok(())
    }

    /// Close a legacy message account and return rent
    pub fn close_message(_ctx: Context<CloseMessage>, _chat_id: u64, _message_index: u64) -> Result<()> {
        msg!("Message closed");
        Ok(())
    }

    // ========== PRIVATE MESSAGING (MagicBlock TEE) ==========
    // Flow: create_chat (existing) -> fund_chat_permission -> delegate_chat_private
    //       -> init_chat_permission (on ER, members-only) -> send_message runs
    //       privately in the TEE -> undelegate_chat -> (admin_force_close reclaims
    //       rent to the admin wallet, exactly like the message cleanup script).

    /// Top up the existing chat PDA with enough lamports for its ephemeral permission
    /// rent, so it can sign/pay when the permission is created on the ER.
    pub fn fund_chat_permission(ctx: Context<FundChatPermission>, _chat_id: u64) -> Result<()> {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer { from: ctx.accounts.payer.to_account_info(), to: ctx.accounts.chat.to_account_info() },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(
                EphemeralPermission::size_of(MAX_PERMISSION_MEMBERS) as u32,
            ),
        )?;
        Ok(())
    }

    /// (Base) Delegate the chat PDA to a TEE validator (first remaining account).
    pub fn delegate_chat_private(ctx: Context<DelegateChatPrivate>, chat_id: u64) -> Result<()> {
        let cid = chat_id.to_le_bytes();
        let validator = ctx.remaining_accounts.first().map(|v| v.key());
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[CHAT_SEED, &cid],
            DelegateConfig { validator, ..Default::default() },
        )?;
        Ok(())
    }

    /// (ER) Create the EphemeralPermission — `Some(members)` = PRIVATE, locked to those wallets.
    pub fn init_chat_permission(ctx: Context<ChatPermissionContext>, chat_id: u64, members: Option<Vec<Member>>) -> Result<()> {
        let (is_private, members) = match members { Some(m) => (true, m), None => (false, vec![]) };
        require!(members.len() <= MAX_PERMISSION_MEMBERS, ShadowError::ContentTooLong);
        if ctx.accounts.permission.owner == &PERMISSION_PROGRAM_ID && !ctx.accounts.permission.data_is_empty() {
            return Ok(());
        }
        let cid = chat_id.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[CHAT_SEED, &cid, std::slice::from_ref(&ctx.bumps.chat)];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.chat.to_account_info(),
            permissioned_account: ctx.accounts.chat.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private, members },
        }
        .invoke_signed(&[signer_seeds])?;
        Ok(())
    }

    /// (ER) Commit chat state to Solana and return control of the chat PDA so it can be closed.
    pub fn undelegate_chat(ctx: Context<UndelegateChat>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.chat.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
            None,
        )?;
        Ok(())
    }

    // ========== PRIVATE INBOX (MagicBlock TEE — the working model) ==========
    // Messages append to a delegated ring-buffer account (mutation works in the ER).

    /// (Base) Create the inbox + pre-fund its ephemeral-permission rent.
    pub fn create_private_inbox(ctx: Context<CreatePrivateInbox>, chat_id: u64) -> Result<()> {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer { from: ctx.accounts.payer.to_account_info(), to: ctx.accounts.inbox.to_account_info() },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(
                EphemeralPermission::size_of(MAX_PERMISSION_MEMBERS) as u32,
            ),
        )?;
        let inbox = &mut ctx.accounts.inbox;
        inbox.chat_id = chat_id;
        inbox.total = 0;
        inbox.messages = Vec::new();
        Ok(())
    }

    /// (Base) Delegate the inbox to a TEE validator (first remaining account).
    pub fn delegate_private_inbox(ctx: Context<DelegatePrivateInbox>, chat_id: u64) -> Result<()> {
        let cid = chat_id.to_le_bytes();
        let validator = ctx.remaining_accounts.first().map(|v| v.key());
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[INBOX_SEED, &cid],
            DelegateConfig { validator, ..Default::default() },
        )?;
        Ok(())
    }

    /// (ER) Create the inbox permission — members-only = PRIVATE.
    pub fn init_inbox_permission(ctx: Context<InboxPermissionContext>, chat_id: u64, members: Option<Vec<Member>>) -> Result<()> {
        let (is_private, members) = match members { Some(m) => (true, m), None => (false, vec![]) };
        require!(members.len() <= MAX_PERMISSION_MEMBERS, ShadowError::ContentTooLong);
        if ctx.accounts.permission.owner == &PERMISSION_PROGRAM_ID && !ctx.accounts.permission.data_is_empty() {
            return Ok(());
        }
        let cid = chat_id.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[INBOX_SEED, &cid, std::slice::from_ref(&ctx.bumps.inbox)];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.inbox.to_account_info(),
            permissioned_account: ctx.accounts.inbox.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private, members },
        }
        .invoke_signed(&[signer_seeds])?;
        Ok(())
    }

    /// (ER) Append a message — MUTATES the delegated inbox (ring buffer).
    pub fn append_private_message(ctx: Context<AppendPrivateMessage>, _chat_id: u64, content: String) -> Result<()> {
        require!(content.len() <= INBOX_MSG_MAX, ShadowError::ContentTooLong);
        let inbox = &mut ctx.accounts.inbox;
        let msg = InboxMsg { sender: ctx.accounts.sender.key(), ts: Clock::get()?.unix_timestamp, content };
        if inbox.messages.len() < INBOX_CAP {
            inbox.messages.push(msg);
        } else {
            let i = (inbox.total as usize) % INBOX_CAP;
            inbox.messages[i] = msg;
        }
        inbox.total = inbox.total.saturating_add(1);
        Ok(())
    }

    /// (ER) Commit inbox state back to Solana.
    pub fn undelegate_private_inbox(ctx: Context<UndelegatePrivateInbox>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.inbox.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
            None,
        )?;
        Ok(())
    }

    /// Close a private inbox and refund its rent to the treasury. Only valid AFTER
    /// undelegate_private_inbox has returned the account to base layer (a delegated
    /// account is owned by the delegation program, so this would fail on it).
    pub fn close_private_inbox(_ctx: Context<ClosePrivateInbox>, _chat_id: u64) -> Result<()> {
        msg!("Private inbox closed, rent refunded to treasury");
        Ok(())
    }

    // ========== ADMIN: FORCE CLOSE ANY ACCOUNT ==========

    /// Admin force-close: lets the upgrade authority close ANY program account
    /// and send rent to the authority. Used for devnet cleanup.
    pub fn admin_force_close(ctx: Context<AdminForceClose>) -> Result<()> {
        let target = &ctx.accounts.target_account;
        let authority = &ctx.accounts.authority;
        
        // Transfer all lamports from target to authority
        let lamports = target.lamports();
        **target.try_borrow_mut_lamports()? = 0;
        **authority.try_borrow_mut_lamports()? = authority.lamports().checked_add(lamports).unwrap();
        
        // Zero out the data and assign to system program to fully close
        target.try_borrow_mut_data()?.fill(0);
        target.assign(&anchor_lang::solana_program::system_program::ID);
        
        msg!("Admin force-closed account: {} ({} lamports reclaimed)", target.key(), lamports);
        Ok(())
    }

}

// ========== ACCOUNT CONTEXT STRUCTS ==========

#[derive(Accounts)]
pub struct CreateProfile<'info> {
    #[account(init_if_needed, payer = payer, space = 8 + Profile::LEN, seeds = [PROFILE_SEED, user.key().as_ref()], bump)]
    pub profile: Account<'info, Profile>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// Fee payer — can be a server keypair for gasless UX
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateProfile<'info> {
    #[account(
        mut,
        realloc = 8 + Profile::LEN,
        realloc::payer = user,
        realloc::zero = false,
        seeds = [PROFILE_SEED, user.key().as_ref()],
        bump,
    )]
    pub profile: Account<'info, Profile>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    #[account(
        mut,
        realloc = 8 + Profile::LEN,
        realloc::payer = payer,
        realloc::zero = false,
        seeds = [PROFILE_SEED, user.key().as_ref()],
        bump,
    )]
    pub profile: Account<'info, Profile>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// Fee payer — treasury pays for realloc rent in gasless UX
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(post_id: u64)]
pub struct CreatePost<'info> {
    #[account(init_if_needed, payer = payer, space = 8 + Post::LEN, seeds = [POST_SEED, profile.owner.as_ref(), &post_id.to_le_bytes()], bump)]
    pub post: Account<'info, Post>,
    #[account(mut, seeds = [PROFILE_SEED, profile.owner.as_ref()], bump)]
    pub profile: Account<'info, Profile>,
    /// The post author — must be the profile owner
    #[account(mut, constraint = author.key() == profile.owner @ ShadowError::Unauthorized)]
    pub author: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(post_id: u64)]
pub struct EditPost<'info> {
    /// The post PDA — seeded by the author's pubkey, so only the real author's post is found
    #[account(mut, seeds = [POST_SEED, author.key().as_ref(), &post_id.to_le_bytes()], bump,
        constraint = post.author == author.key() @ ShadowError::Unauthorized)]
    pub post: Account<'info, Post>,
    /// Must be the original author — if anyone else signs, the seed/constraint check fails
    pub author: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(post_id: u64)]
pub struct LikePost<'info> {
    #[account(mut, seeds = [POST_SEED, post.author.as_ref(), &post_id.to_le_bytes()], bump)]
    pub post: Account<'info, Post>,
    #[account(seeds = [PROFILE_SEED, profile.owner.as_ref()], bump)]
    pub profile: Account<'info, Profile>,
    /// One LikeRecord PDA per (post, liker) — init will fail if they've already liked
    #[account(
        init,
        payer = payer,
        space = 8 + LikeRecord::LEN,
        seeds = [LIKE_SEED, post.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub like_record: Account<'info, LikeRecord>,
    /// The liker — must be the profile owner (read-only, no SOL needed)
    #[account(constraint = user.key() == profile.owner @ ShadowError::Unauthorized)]
    pub user: Signer<'info>,
    /// Treasury pays for like_record rent
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(post_id: u64, comment_index: u64)]
pub struct CreateComment<'info> {
    #[account(init_if_needed, payer = payer, space = 8 + Comment::LEN, seeds = [COMMENT_SEED, post.key().as_ref(), &comment_index.to_le_bytes()], bump)]
    pub comment: Account<'info, Comment>,
    #[account(mut, seeds = [POST_SEED, post.author.as_ref(), &post_id.to_le_bytes()], bump)]
    pub post: Account<'info, Post>,
    #[account(seeds = [PROFILE_SEED, commenter_profile.owner.as_ref()], bump)]
    pub commenter_profile: Account<'info, Profile>,
    /// The commenter — must be the commenter_profile owner
    #[account(mut, constraint = author.key() == commenter_profile.owner @ ShadowError::Unauthorized)]
    pub author: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(post_id: u64)]
pub struct ReactToPost<'info> {
    #[account(init, payer = payer, space = 8 + Reaction::LEN, seeds = [REACTION_SEED, post.key().as_ref(), reactor_profile.owner.as_ref()], bump)]
    pub reaction: Account<'info, Reaction>,
    #[account(seeds = [POST_SEED, post.author.as_ref(), &post_id.to_le_bytes()], bump)]
    pub post: Account<'info, Post>,
    #[account(seeds = [PROFILE_SEED, reactor_profile.owner.as_ref()], bump)]
    pub reactor_profile: Account<'info, Profile>,
    /// The reactor — must be the reactor_profile owner
    #[account(mut, constraint = user.key() == reactor_profile.owner @ ShadowError::Unauthorized)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(chat_id: u64)]
pub struct CreateChat<'info> {
    #[account(init_if_needed, payer = payer, space = 8 + Chat::LEN, seeds = [CHAT_SEED, &chat_id.to_le_bytes()], bump)]
    pub chat: Account<'info, Chat>,
    #[account(mut)]
    pub user1: Signer<'info>,
    /// CHECK: Second chat participant — must be different from user1
    #[account(constraint = user2.key() != user1.key() @ ShadowError::Unauthorized)]
    pub user2: UncheckedAccount<'info>,
    /// Fee payer — treasury for gasless UX
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(chat_id: u64, message_index: u64)]
pub struct SendMessage<'info> {
    #[account(init_if_needed, payer = payer, space = 8 + Message::LEN, seeds = [MESSAGE_SEED, &chat_id.to_le_bytes(), &message_index.to_le_bytes()], bump)]
    pub message: Account<'info, Message>,
    #[account(mut, seeds = [CHAT_SEED, &chat_id.to_le_bytes()], bump)]
    pub chat: Account<'info, Chat>,
    /// Message sender — must be a participant in the chat
    #[account(mut, constraint = (sender.key() == chat.user1 || sender.key() == chat.user2) @ ShadowError::Unauthorized)]
    pub sender: Signer<'info>,
    /// Fee payer — treasury for gasless UX
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ========== FOLLOW CONTEXTS ==========

#[derive(Accounts)]
pub struct FollowUser<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + FollowAccount::LEN,
        seeds = [FOLLOW_SEED, follower_profile.owner.as_ref(), following_profile.owner.as_ref()],
        bump
    )]
    pub follow_account: Account<'info, FollowAccount>,
    #[account(mut, seeds = [PROFILE_SEED, user.key().as_ref()], bump)]
    pub follower_profile: Account<'info, Profile>,
    #[account(mut, seeds = [PROFILE_SEED, following_profile.owner.as_ref()], bump)]
    pub following_profile: Account<'info, Profile>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// Fee payer — can be a server keypair for gasless UX
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnfollowUser<'info> {
    #[account(
        mut,
        close = treasury,
        seeds = [FOLLOW_SEED, follower_profile.owner.as_ref(), following_profile.owner.as_ref()],
        bump
    )]
    pub follow_account: Account<'info, FollowAccount>,
    #[account(mut, seeds = [PROFILE_SEED, user.key().as_ref()], bump)]
    pub follower_profile: Account<'info, Profile>,
    #[account(mut, seeds = [PROFILE_SEED, following_profile.owner.as_ref()], bump)]
    pub following_profile: Account<'info, Profile>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// Treasury wallet — rent refund destination
    /// CHECK: Verified via constraint
    #[account(mut, constraint = treasury.key() == TREASURY_PUBKEY @ ShadowError::Unauthorized)]
    pub treasury: AccountInfo<'info>,
}

// ========== COMMUNITY CONTEXTS ==========

#[derive(Accounts)]
#[instruction(community_id: u64)]
pub struct CreateCommunity<'info> {
    #[account(init, payer = payer, space = 8 + Community::LEN, seeds = [COMMUNITY_SEED, &community_id.to_le_bytes()], bump)]
    pub community: Account<'info, Community>,
    #[account(seeds = [PROFILE_SEED, user.key().as_ref()], bump)]
    pub creator_profile: Account<'info, Profile>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(community_id: u64)]
pub struct JoinCommunity<'info> {
    #[account(init, payer = payer, space = 8 + Membership::LEN, seeds = [MEMBERSHIP_SEED, community.key().as_ref(), member_profile.owner.as_ref()], bump)]
    pub membership: Account<'info, Membership>,
    #[account(mut, seeds = [COMMUNITY_SEED, &community_id.to_le_bytes()], bump)]
    pub community: Account<'info, Community>,
    #[account(seeds = [PROFILE_SEED, user.key().as_ref()], bump)]
    pub member_profile: Account<'info, Profile>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(community_id: u64)]
pub struct LeaveCommunity<'info> {
    #[account(mut, close = treasury, seeds = [MEMBERSHIP_SEED, community.key().as_ref(), member_profile.owner.as_ref()], bump)]
    pub membership: Account<'info, Membership>,
    #[account(mut, seeds = [COMMUNITY_SEED, &community_id.to_le_bytes()], bump)]
    pub community: Account<'info, Community>,
    #[account(seeds = [PROFILE_SEED, user.key().as_ref()], bump)]
    pub member_profile: Account<'info, Profile>,
    /// Must be the profile owner — prevents others from kicking members
    #[account(mut, constraint = user.key() == member_profile.owner @ ShadowError::Unauthorized)]
    pub user: Signer<'info>,
    /// CHECK: Verified via constraint
    #[account(mut, constraint = treasury.key() == TREASURY_PUBKEY @ ShadowError::Unauthorized)]
    pub treasury: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(community_id: u64)]
pub struct UpdateCommunity<'info> {
    #[account(
        mut,
        seeds = [COMMUNITY_SEED, &community_id.to_le_bytes()],
        bump,
        constraint = community.creator == user.key() @ ShadowError::Unauthorized
    )]
    pub community: Account<'info, Community>,
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(community_id: u64)]
pub struct CloseCommunity<'info> {
    #[account(
        mut,
        close = treasury,
        seeds = [COMMUNITY_SEED, &community_id.to_le_bytes()],
        bump,
        constraint = community.creator == user.key() @ ShadowError::Unauthorized
    )]
    pub community: Account<'info, Community>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: Verified via constraint
    #[account(mut, constraint = treasury.key() == TREASURY_PUBKEY @ ShadowError::Unauthorized)]
    pub treasury: AccountInfo<'info>,
}

// ========== CLOSE ACCOUNT CONTEXTS ==========

#[derive(Accounts)]
pub struct CloseProfile<'info> {
    #[account(mut, close = treasury, seeds = [PROFILE_SEED, user.key().as_ref()], bump)]
    pub profile: Account<'info, Profile>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// Treasury wallet — rent refund destination
    /// CHECK: Verified via constraint
    #[account(mut, constraint = treasury.key() == TREASURY_PUBKEY @ ShadowError::Unauthorized)]
    pub treasury: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(post_id: u64)]
pub struct ClosePost<'info> {
    #[account(mut, close = treasury, seeds = [POST_SEED, user.key().as_ref(), &post_id.to_le_bytes()], bump)]
    pub post: Account<'info, Post>,
    #[account(mut, seeds = [PROFILE_SEED, user.key().as_ref()], bump)]
    pub profile: Account<'info, Profile>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// Treasury wallet — rent refund destination
    /// CHECK: Verified via constraint
    #[account(mut, constraint = treasury.key() == TREASURY_PUBKEY @ ShadowError::Unauthorized)]
    pub treasury: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(post_id: u64, comment_index: u64)]
pub struct CloseComment<'info> {
    #[account(mut, close = treasury, seeds = [COMMENT_SEED, post.key().as_ref(), &comment_index.to_le_bytes()], bump)]
    pub comment: Account<'info, Comment>,
    #[account(mut, seeds = [POST_SEED, post.author.as_ref(), &post_id.to_le_bytes()], bump)]
    pub post: Account<'info, Post>,
    #[account(mut, constraint = user.key() == comment.author @ ShadowError::Unauthorized)]
    pub user: Signer<'info>,
    /// Treasury wallet — rent refund destination
    /// CHECK: Verified via constraint
    #[account(mut, constraint = treasury.key() == TREASURY_PUBKEY @ ShadowError::Unauthorized)]
    pub treasury: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(post_id: u64)]
pub struct CloseReaction<'info> {
    #[account(mut, close = treasury, seeds = [REACTION_SEED, post.key().as_ref(), user.key().as_ref()], bump)]
    pub reaction: Account<'info, Reaction>,
    #[account(seeds = [POST_SEED, post.author.as_ref(), &post_id.to_le_bytes()], bump)]
    pub post: Account<'info, Post>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// Treasury wallet — rent refund destination
    /// CHECK: Verified via constraint
    #[account(mut, constraint = treasury.key() == TREASURY_PUBKEY @ ShadowError::Unauthorized)]
    pub treasury: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(chat_id: u64)]
pub struct CloseChat<'info> {
    #[account(mut, close = treasury, seeds = [CHAT_SEED, &chat_id.to_le_bytes()], bump,
        constraint = (user.key() == chat.user1 || user.key() == chat.user2) @ ShadowError::Unauthorized)]
    pub chat: Account<'info, Chat>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// Treasury wallet — rent refund destination
    /// CHECK: Verified via constraint
    #[account(mut, constraint = treasury.key() == TREASURY_PUBKEY @ ShadowError::Unauthorized)]
    pub treasury: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(chat_id: u64, message_index: u64)]
pub struct CloseMessage<'info> {
    #[account(mut, close = treasury, seeds = [MESSAGE_SEED, &chat_id.to_le_bytes(), &message_index.to_le_bytes()], bump)]
    pub message: Account<'info, Message>,
    #[account(mut, constraint = user.key() == message.sender @ ShadowError::Unauthorized)]
    pub user: Signer<'info>,
    /// Treasury wallet — rent refund destination
    /// CHECK: Verified via constraint
    #[account(mut, constraint = treasury.key() == TREASURY_PUBKEY @ ShadowError::Unauthorized)]
    pub treasury: AccountInfo<'info>,
}

// ========== PRIVATE MESSAGING CONTEXTS (MagicBlock TEE) ==========

#[derive(Accounts)]
#[instruction(chat_id: u64)]
pub struct FundChatPermission<'info> {
    #[account(mut, seeds = [CHAT_SEED, &chat_id.to_le_bytes()], bump)]
    pub chat: Account<'info, Chat>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(chat_id: u64)]
pub struct DelegateChatPrivate<'info> {
    /// CHECK: chat PDA being delegated
    #[account(mut, del, seeds = [CHAT_SEED, &chat_id.to_le_bytes()], bump)]
    pub pda: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

/// Shared ER-side context for the chat's ephemeral permission.
#[derive(Accounts)]
#[instruction(chat_id: u64)]
pub struct ChatPermissionContext<'info> {
    #[account(mut, constraint = (authority.key() == chat.user1 || authority.key() == chat.user2) @ ShadowError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CHAT_SEED, &chat_id.to_le_bytes()], bump)]
    pub chat: Account<'info, Chat>,
    /// CHECK: permission PDA under the permission program
    #[account(mut, seeds = [PERMISSION_SEED, chat.key().as_ref()], bump, seeds::program = permission_program.key())]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: MagicBlock permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateChat<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: chat account to undelegate
    #[account(mut)]
    pub chat: UncheckedAccount<'info>,
}

// ========== PRIVATE INBOX CONTEXTS ==========

#[derive(Accounts)]
#[instruction(chat_id: u64)]
pub struct CreatePrivateInbox<'info> {
    #[account(init, payer = payer, space = 8 + PrivateInbox::LEN, seeds = [INBOX_SEED, &chat_id.to_le_bytes()], bump)]
    pub inbox: Account<'info, PrivateInbox>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(chat_id: u64)]
pub struct DelegatePrivateInbox<'info> {
    /// CHECK: inbox PDA being delegated
    #[account(mut, del, seeds = [INBOX_SEED, &chat_id.to_le_bytes()], bump)]
    pub pda: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(chat_id: u64)]
pub struct InboxPermissionContext<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [INBOX_SEED, &chat_id.to_le_bytes()], bump)]
    pub inbox: Account<'info, PrivateInbox>,
    /// CHECK: permission PDA under the permission program
    #[account(mut, seeds = [PERMISSION_SEED, inbox.key().as_ref()], bump, seeds::program = permission_program.key())]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: MagicBlock permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(chat_id: u64)]
pub struct AppendPrivateMessage<'info> {
    #[account(mut, seeds = [INBOX_SEED, &chat_id.to_le_bytes()], bump)]
    pub inbox: Account<'info, PrivateInbox>,
    pub sender: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegatePrivateInbox<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: inbox account to undelegate
    #[account(mut)]
    pub inbox: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(chat_id: u64)]
pub struct ClosePrivateInbox<'info> {
    #[account(mut, close = treasury, seeds = [INBOX_SEED, &chat_id.to_le_bytes()], bump)]
    pub inbox: Account<'info, PrivateInbox>,
    /// CHECK: hardcoded treasury — receives the reclaimed rent
    #[account(mut, constraint = treasury.key() == TREASURY_PUBKEY @ ShadowError::Unauthorized)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InboxMsg {
    pub sender: Pubkey,
    pub ts: i64,
    pub content: String,
}
impl InboxMsg {
    pub const LEN: usize = 32 + 8 + 4 + INBOX_MSG_MAX;
}

#[account]
pub struct PrivateInbox {
    pub chat_id: u64,
    pub total: u64,
    pub messages: Vec<InboxMsg>,
}
impl PrivateInbox {
    // fixed allocation for the full ring buffer so the delegated account never reallocs
    pub const LEN: usize = 8 + 8 + 4 + INBOX_CAP * InboxMsg::LEN;
}

// ========== ADMIN FORCE CLOSE ==========

/// Only this wallet (the upgrade authority) can call admin_force_close
const ADMIN_AUTHORITY: Pubkey = pubkey!("8wf9jJrsUPtCrWwzXxXMkEQSWX2A4sSNAVRSNjuty4j");

#[derive(Accounts)]
pub struct AdminForceClose<'info> {
    /// CHECK: Any program-owned account to close. We verify it's owned by our program.
    #[account(mut, constraint = target_account.owner == &crate::ID @ ShadowError::Unauthorized)]
    pub target_account: AccountInfo<'info>,
    /// The upgrade authority — hardcoded, only this wallet can force-close
    #[account(mut, constraint = authority.key() == ADMIN_AUTHORITY @ ShadowError::Unauthorized)]
    pub authority: Signer<'info>,
}

// ========== POLL CONTEXTS ==========

#[derive(Accounts)]
#[instruction(poll_id: u64)]
pub struct CreatePoll<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Poll::LEN,
        seeds = [POLL_SEED, profile.owner.as_ref(), &poll_id.to_le_bytes()],
        bump
    )]
    pub poll: Account<'info, Poll>,
    #[account(mut, seeds = [PROFILE_SEED, user.key().as_ref()], bump)]
    pub profile: Account<'info, Profile>,
    #[account(mut, constraint = user.key() == profile.owner @ ShadowError::Unauthorized)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(poll_id: u64)]
pub struct VotePoll<'info> {
    #[account(
        mut,
        seeds = [POLL_SEED, poll.creator.as_ref(), &poll_id.to_le_bytes()],
        bump
    )]
    pub poll: Account<'info, Poll>,
    #[account(
        init,
        payer = payer,
        space = 8 + PollVote::LEN,
        seeds = [POLL_VOTE_SEED, poll.key().as_ref(), voter_profile.owner.as_ref()],
        bump
    )]
    pub poll_vote: Account<'info, PollVote>,
    #[account(seeds = [PROFILE_SEED, user.key().as_ref()], bump)]
    pub voter_profile: Account<'info, Profile>,
    #[account(mut, constraint = user.key() == voter_profile.owner @ ShadowError::Unauthorized)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(poll_id: u64)]
pub struct ClosePoll<'info> {
    #[account(
        mut,
        seeds = [POLL_SEED, poll.creator.as_ref(), &poll_id.to_le_bytes()],
        bump,
        constraint = poll.creator == user.key() @ ShadowError::Unauthorized
    )]
    pub poll: Account<'info, Poll>,
    #[account(mut)]
    pub user: Signer<'info>,
}

// ========== DATA ACCOUNTS ==========

#[account]
pub struct Profile {
    pub owner: Pubkey,
    pub username: String,
    pub display_name: String,
    pub bio: String,
    pub is_private: bool,
    pub post_count: u32,
    pub follower_count: u32,
    pub following_count: u32,
    pub active_conversation_count: u16, // legacy field — must stay for deserialization
    pub created_at: i64,
    pub avatar_url: String,
    pub banner_url: String,
}

impl Profile {
    // 32(owner) + (4+16)(username) + (4+24)(display) + (4+64)(bio) + 1(private)
    // + 4(posts) + 4(followers) + 4(following) + 2(convos legacy) + 8(created)
    // + (4+128)(avatar) + (4+128)(banner) + (4+64)(website)
    pub const LEN: usize = 32 + 4 + 16 + 4 + 24 + 4 + 64 + 1 + 4 + 4 + 4 + 2 + 8 + 4 + 128 + 4 + 128;
}

#[account]
pub struct Post {
    pub author: Pubkey,
    pub post_id: u64,
    pub content: String,
    pub is_private: bool,
    pub likes: u32,
    pub comment_count: u32,
    pub created_at: i64,
    pub updated_at: i64,  // 0 means never edited
}

impl Post {
    // 32(author) + 8(post_id) + 4(str_prefix) + 500(content) + 1(private) + 4(likes) + 4(comments) + 8(created_at) + 8(updated_at)
    pub const LEN: usize = 32 + 8 + 4 + 500 + 1 + 4 + 4 + 8 + 8;
}

#[account]
pub struct Comment {
    pub post: Pubkey,
    pub author: Pubkey,
    pub comment_index: u64,
    pub content: String,
    pub created_at: i64,
}

impl Comment {
    // 32(post) + 32(author) + 8(index) + 4(str_prefix) + 100(content) + 8(timestamp)
    pub const LEN: usize = 32 + 32 + 8 + 4 + 100 + 8;
}

#[account]
pub struct Reaction {
    pub post: Pubkey,
    pub user: Pubkey,
    pub reaction_type: u8,
}

impl Reaction {
    pub const LEN: usize = 32 + 32 + 1;
}

#[account]
pub struct Chat {
    pub chat_id: u64,
    pub user1: Pubkey,
    pub user2: Pubkey,
    pub message_count: u64,
    pub created_at: i64,
}

impl Chat {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8;
}

#[account]
pub struct Message {
    pub chat_id: u64,
    pub message_index: u64,
    pub sender: Pubkey,
    pub content: String,
    pub is_payment: bool,
    pub payment_amount: u64,
    pub timestamp: i64,
}

impl Message {
    pub const LEN: usize = 8 + 8 + 32 + 4 + 512 + 1 + 8 + 8;
}

#[account]
pub struct FollowAccount {
    pub follower: Pubkey,
    pub following: Pubkey,
}

impl FollowAccount {
    // 32(follower) + 32(following)
    pub const LEN: usize = 32 + 32;
}

#[account]
pub struct Community {
    pub creator: Pubkey,
    pub community_id: u64,
    pub name: String,
    pub description: String,
    pub avatar_url: String,
    pub member_count: u32,
    pub created_at: i64,
}

impl Community {
    // 32(creator) + 8(id) + (4+32)(name) + (4+128)(desc) + (4+128)(avatar) + 4(members) + 8(created)
    pub const LEN: usize = 32 + 8 + 4 + 32 + 4 + 128 + 4 + 128 + 4 + 8;
}

#[account]
pub struct Membership {
    pub community: Pubkey,
    pub member: Pubkey,
    pub joined_at: i64,
}

impl Membership {
    // 32(community) + 32(member) + 8(joined_at)
    pub const LEN: usize = 32 + 32 + 8;
}

#[account]
pub struct Poll {
    pub creator: Pubkey,        // 32
    pub poll_id: u64,           // 8
    pub question: String,       // 4 + 200
    pub option_a: String,       // 4 + 50
    pub option_b: String,       // 4 + 50
    pub option_c: String,       // 4 + 50
    pub option_d: String,       // 4 + 50
    pub num_options: u8,        // 1
    pub votes_a: u32,           // 4
    pub votes_b: u32,           // 4
    pub votes_c: u32,           // 4
    pub votes_d: u32,           // 4
    pub total_votes: u32,       // 4
    pub ends_at: i64,           // 8
    pub is_closed: bool,        // 1
    pub created_at: i64,        // 8
}

impl Poll {
    // 32 + 8 + (4+200) + (4+50)*4 + 1 + 4*4 + 4 + 8 + 1 + 8
    pub const LEN: usize = 32 + 8 + 204 + 54 + 54 + 54 + 54 + 1 + 4 + 4 + 4 + 4 + 4 + 8 + 1 + 8;
}

#[account]
pub struct PollVote {
    pub poll: Pubkey,           // 32
    pub voter: Pubkey,          // 32
    pub choice: u8,             // 1
    pub voted_at: i64,          // 8
}

impl PollVote {
    // 32 + 32 + 1 + 8
    pub const LEN: usize = 32 + 32 + 1 + 8;
}

#[account]
pub struct LikeRecord {
    pub post: Pubkey,    // 32 — which post was liked
    pub liker: Pubkey,   // 32 — who liked it
    pub liked_at: i64,   // 8  — timestamp
}

impl LikeRecord {
    // 32 + 32 + 8
    pub const LEN: usize = 32 + 32 + 8;
}

// ========== ERRORS ==========

#[error_code]
pub enum ShadowError {
    #[msg("Already following this user")]
    AlreadyFollowing,
    #[msg("Not following this user")]
    NotFollowing,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Content too long")]
    ContentTooLong,
    #[msg("Cannot follow yourself")]
    CannotFollowSelf,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Community is full (max 100 members)")]
    CommunityFull,
    #[msg("Account already initialized")]
    AlreadyInitialized,
    #[msg("Poll must have 2-4 options")]
    InvalidPollOptions,
    #[msg("Invalid poll choice")]
    InvalidPollChoice,
    #[msg("Poll has ended")]
    PollAlreadyEnded,
    #[msg("Already liked this post")]
    AlreadyLiked,
    #[msg("Cannot like your own post")]
    CannotLikeOwnPost,
    #[msg("Invalid reaction type")]
    InvalidReactionType,
}
