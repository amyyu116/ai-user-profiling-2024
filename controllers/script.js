const Groq = require('groq-sdk');
const Script = require('../models/Script.js');
const User = require('../models/User');
const Notification = require('../models/Notification');
const helpers = require('./helpers');
const _ = require('lodash');
const dotenv = require('dotenv');
const Actor = require('../models/Actor.js');
dotenv.config({ path: '.env' }); // See the file .env.example for the structure of .env

/**
 * GET /
 * Fetch and render newsfeed.
 */
exports.getScript = async (req, res, next) => {
    try {
        const one_day = 86400000; // Number of milliseconds in a day.
        const time_now = Date.now(); // Current date.
        const time_diff = time_now - req.user.createdAt; // Time difference between now and user account creation, in milliseconds.
        const time_limit = time_diff - one_day; // Date in milliseconds 24 hours ago from now. This is used later to show posts only in the past 24 hours.
        const offset = 0;
        const user = await User.findById(req.user.id)
            .populate('posts.comments.actor')
            .exec();

        // If the user is no longer active, sign the user out.
        if (!user.active) {
            req.logout((err) => {
                if (err) console.log('Error : Failed to logout.', err);
                req.session.destroy((err) => {
                    if (err) console.log('Error : Failed to destroy the session during logout.', err);
                    req.user = null;
                    req.flash('errors', { msg: 'Account is no longer active. Study is over.' });
                    res.redirect('/login');
                });
            });
        }

        // What day in the study is the user in? 
        // Update study_days, which tracks the number of time user views feed.
        const current_day = Math.floor(time_diff / one_day);
        if (current_day < process.env.NUM_DAYS) {
            user.study_days[current_day] += 1;
            // saved = await user.save();
        }

        // Array of actor posts that match the user's experimental condition, within the past 24 hours, sorted by descending time. 
        let feed_filter = user.profile.topics;

        let script_feed = await Script.find({
            topics: { "$in": feed_filter }
        })
            .where('time').lte(time_diff).gte(time_limit)
            .skip(offset)
            .sort('-time')
            .limit(500)
            .populate('actor')
            .populate('comments.actor')
            .exec();
        let additional_posts = [];
        if (script_feed.length <= 100) {
            additional_posts = await Script.find({
                class: { "$in": ["", user.experimentalCondition] },
                topics: { "$nin": feed_filter } // Excluding posts with topics already in the feed
            })
                .where('time').lte(time_diff).gte(time_limit)
                .sort('-time')
                .populate('actor')
                .populate('comments.actor')
                .limit(500)
                .exec();
        }
        script_feed = script_feed.concat(additional_posts);
        // Array of any user-made posts within the past 24 hours, sorted by time they were created.
        let user_posts = user.getPostInPeriod(time_limit, time_diff);
        user_posts.sort(function (a, b) {
            return b.relativeTime - a.relativeTime;
        });

        // Get the newsfeed and render it.
        const finalfeed = helpers.getFeed(user_posts, script_feed, user, process.env.FEED_ORDER, true, true, user.profile.topics);
        console.log("Script Size is now: " + finalfeed.length);
        res.render('script', { script: finalfeed, showNewPostIcon: true });
    } catch (err) {
        next(err);
    }
};

function timeStringToNum(v) {
    var timeParts = v.split(":");
    if (timeParts[0] == "-0")
        // -0:XX
        return -1 * parseInt(((timeParts[0] * (60000 * 60)) + (timeParts[1] * 60000)), 10);
    else if (timeParts[0].startsWith('-'))
        //-X:XX
        return parseInt(((timeParts[0] * (60000 * 60)) + (-1 * (timeParts[1] * 60000))), 10);
    else
        return parseInt(((timeParts[0] * (60000 * 60)) + (timeParts[1] * 60000)), 10);
};

// AI-generation helper functions
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function getResponse(post, user, actorID = null) {
    // get system prompt
    let sysPrompt = "You are a 21-year old male social media user."
    if (actorID != null) {
        try {
            let actor = await Actor.findOne({ id: actorID }).exec();
            actor = await Actor.findById(actorID).exec();
            sysPrompt = `You are a ${actor.profile.age}-year old ${actor.profile.gender} on a social media platform. ${actor.profile.name ? `On your profile, your name is "${actor.profile.name}".` : ''}.
            ${actor.profile.bio ? `your biography is "${actor.profile.bio}".` : ''} ${actor.profile.location ? `and your location is "${actor.profile.location}".` : ''}`;
            // fetch comments associated with post
            let comments = [];
            if (post.comments) {
                for (const comment of post.comments) {
                    comments.push(comment);
                }
            }

            // filter comments to display only "present" comments generated by current user
            comments = comments.filter(comment => user.createdAt.getTime() + comment.time < Date.now());
            comments = comments.filter(comment => !comment.userID || comment.userID.equals(user._id));
            if (post.actor) {
                // looks for user-made comments if this is a scripted post
                const feedIndex = _.findIndex(user.feedAction, function (o) {
                    return o.post && o.post.equals(post.id);
                });
                if (user.feedAction[feedIndex].comments) {
                    for (const comment of user.feedAction[feedIndex].comments) {
                        comments.push(comment);
                    }
                }
            }

            // standardize the time field to allow for sorting
            comments.forEach(comment => {
                if (!comment.time && comment.relativeTime) {
                    comment.time = comment.relativeTime;
                }
            });

            // sort comments in chronological order
            comments.sort(function (a, b) {
                return a.time - b.time;
            });

            let response = "You should not be seeing this!";
            // check if post is new and has comments
            if (comments.length == 0 && !post.actor) {
                chatCompletion = await generateComment(post, sysPrompt);
            } else {
                chatCompletion = await generateReply(post, comments, sysPrompt);
            }
            response = chatCompletion.choices[0].message.content;
            if (actor) {
                if (actor.profile.bio.toLowerCase() === actor.profile.bio) {
                    response = response.toLowerCase();
                }
            }
            return response;
        }
        catch (err) {
            console.log("There was an error fetching your actor");

        }
    }
}

// response to comment chains
async function generateReply(post, comments, sysPrompt = '') {
    let promptMessages = [
        {
            role: "system",
            content: sysPrompt,
        }
    ];
    let postMessage;

    // checking if user-made post or scripted
    if (post.actor) {
        postMessage = {
            role: "assistant",
            content: post.body.trim()
        };
    }
    else {
        postMessage = {
            role: "user",
            content: post.body.trim()
        };
    }
    promptMessages.push(postMessage);

    // parsing comments, remove mentions
    for (const comment of comments) {
        let content = comment.body
            .split(' ')
            .filter(word => !word.startsWith('@'))
            .join(' ');
        let role = "user";
        if (comment.actor) {
            role = "assistant";
        }
        const newMessage = {
            role: role,
            content: content.trim(),
        };
        promptMessages.push(newMessage);
    }
    console.log(promptMessages);
    return groq.chat.completions.create({
        messages: promptMessages,
        model: "llama3-8b-8192",
    });
}

// generating response to new, user-made post (a.k.a., no existing comments)
async function generateComment(post, sysPrompt) {

    return groq.chat.completions.create({
        messages: [
            {
                role: "system",
                content: sysPrompt,
            },
            {
                role: "user",
                content: post.body
            }
        ],
        model: "llama3-8b-8192",
    });
}


/*
 * Post /post/new
 * Record a new user-made post. Include any actor replies (comments) that go along with it.
 */
exports.newPost = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id).exec();
        if (req.body) {
            user.numPosts = user.numPosts + 1; // Count begins at 0
            const currDate = Date.now();
            const filename = '';
            if (req.file) {
                filename = req.file.filename;
            }
            let post = {
                type: "user_post",
                postID: user.numPosts,
                body: req.body.body || '',
                picture: filename,
                liked: false,
                likes: 0,
                comments: [],
                absTime: currDate,
                relativeTime: currDate - user.createdAt,
            };

            // Generate a dynamic response via AI.

            if (req.body.body) {
                // randomly selects an actor to reply to your post
                const randomActor = await Actor.aggregate([{ $sample: { size: 1 } }]).exec();
                const dummy = randomActor[0];
                AIResponse = await getResponse(post, user, dummy);
                const notifdetails = {
                    actor: dummy,
                    notificationType: 'reply',
                    userID: user._id,
                    time: timeStringToNum("0:02"),
                    userPost: true,
                    userPostID: post.postID,
                    replyBody: AIResponse,
                    class: "",

                }
                const newnotif = new Notification(notifdetails);
                try {
                    await newnotif.save();
                } catch (err) {
                    console.log(err);
                    next(err);
                }
            }

            // Find any Actor replies (comments) that go along with this post
            const actor_replies = await Notification.find({
                $or: [
                    { userID: { $exists: false } },
                    { userID: user._id }
                ]
            })
                .where('userPostID').equals(post.postID)
                .where('notificationType').equals('reply')
                .populate('actor').exec();

            // If there are Actor replies (comments) that go along with this post, add them to the user's post.
            if (actor_replies.length > 0) {
                for (const reply of actor_replies) {
                    user.numActorReplies = user.numActorReplies + 1; // Count begins at 0
                    const tmp_actor_reply = {
                        actor: reply.actor._id,
                        body: reply.replyBody,
                        commentID: user.numActorReplies,
                        relativeTime: reply.time,
                        absTime: new Date(user.createdAt.getTime() + post.relativeTime + reply.time),
                        new_comment: false,
                        liked: false,
                        flagged: false,
                        likes: 0
                    };
                    post.comments.push(tmp_actor_reply);
                }
            }

            user.posts.unshift(post); // Add most recent user-made post to the beginning of the array
            saved = await user.save();
            res.redirect('/');
        } else {
            req.flash('errors', { msg: 'ERROR: Your post did not get sent. Please include a photo and a caption.' });
            res.redirect('/');
        }
    } catch (err) {
        next(err);
    }
};

/**
 * POST /feed/
 * Record user's actions on ACTOR posts. 
 */
exports.postUpdateFeedAction = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id).exec();
        // Check if user has interacted with the post before.
        let feedIndex = _.findIndex(user.feedAction, function (o) { return o.post == req.body.postID; });

        // If the user has not interacted with the post before, add the post to user.feedAction.
        if (feedIndex == -1) {
            const cat = {
                post: req.body.postID,
                postClass: req.body.postClass,
            };
            feedIndex = user.feedAction.push(cat) - 1;
        }

        // User created a new comment on the post.
        if (req.body.new_comment) {
            user.numComments = user.numComments + 1;
            const cat = {
                new_comment: true,
                new_comment_id: user.numComments,
                body: req.body.comment_text,
                relativeTime: req.body.new_comment - user.createdAt,
                absTime: req.body.new_comment,
                liked: false,
                flagged: false,
            }
            user.feedAction[feedIndex].comments.push(cat);
            // update script object corresponding to the post with ai-generated comment
            // find the actor for the original post
            await user.save();
            const post = await Script.findOne({ _id: req.body.postID })
                .populate('actor')
                .populate('comments')
                .exec();
            let AIActor = post.actor;
            let mentioned = cat.body.match(/@\w+/);

            // check if comment is not addressing the original poster
            if (mentioned) {
                mentioned = mentioned[0].substring(1);
                AIActor = await Actor.findOne({ username: mentioned });
            }
            const AIResponse = await getResponse(post, user, AIActor);
            const new_reply = {
                commentID: post.comments.length,
                body: `@${user.username} ` + AIResponse,
                likes: 0,
                actor: AIActor,
                userID: user._id,
                time: cat.relativeTime + 60000,
                class: "",
                new_comment: false,
                liked: false,
            }
            post.comments.push(new_reply);
            try {
                post.save();
            } catch (err) {
                console.log(err);
                next(err);
            }
            // create a new notification object corresponding to the post
            const notifdetails = {
                key: 'reply_reply',
                actor: AIActor,
                notificationType: 'reply',
                userID: user._id,
                userReplyID: user.numComments,
                time: timeStringToNum("0:01"),
                postID: post._id,
                replyBody: AIResponse,
                class: "",

            }
            const newnotif = new Notification(notifdetails);
            try {
                await newnotif.save();
            } catch (err) {
                console.log(err);
                next(err);
            }
        }
        // User interacted with a comment on the post.
        else if (req.body.commentID) {
            const isUserComment = (req.body.isUserComment == 'true');
            // Check if user has interacted with the comment before.
            let commentIndex = (isUserComment) ?
                _.findIndex(user.feedAction[feedIndex].comments, function (o) {
                    return o.new_comment_id == req.body.commentID && o.new_comment == isUserComment
                }) :
                _.findIndex(user.feedAction[feedIndex].comments, function (o) {
                    return o.comment == req.body.commentID && o.new_comment == isUserComment
                });

            // If the user has not interacted with the comment before, add the comment to user.feedAction[feedIndex].comments
            if (commentIndex == -1) {
                const cat = {
                    comment: req.body.commentID
                };
                user.feedAction[feedIndex].comments.push(cat);
                commentIndex = user.feedAction[feedIndex].comments.length - 1;
            }

            // User liked the comment.
            if (req.body.like) {
                const like = req.body.like;
                user.feedAction[feedIndex].comments[commentIndex].likeTime.push(like);
                user.feedAction[feedIndex].comments[commentIndex].liked = true;
                if (req.body.isUserComment != 'true') user.numCommentLikes++;
            }

            // User unliked the comment.
            if (req.body.unlike) {
                const unlike = req.body.unlike;
                user.feedAction[feedIndex].comments[commentIndex].unlikeTime.push(unlike);
                user.feedAction[feedIndex].comments[commentIndex].liked = false;
                if (req.body.isUserComment != 'true') user.numCommentLikes--;
            }

            // User flagged the comment.
            else if (req.body.flag) {
                const flag = req.body.flag;
                user.feedAction[feedIndex].comments[commentIndex].flagTime.push(flag);
                user.feedAction[feedIndex].comments[commentIndex].flagged = true;
            }
        }
        // User interacted with the post.
        else {
            // User flagged the post.
            if (req.body.flag) {
                const flag = req.body.flag;
                user.feedAction[feedIndex].flagTime = [flag];
                user.feedAction[feedIndex].flagged = true;
            }

            // User liked the post.
            else if (req.body.like) {
                const like = req.body.like;
                user.feedAction[feedIndex].likeTime.push(like);
                user.feedAction[feedIndex].liked = true;
                user.numPostLikes++;
            }
            // User unliked the post.
            else if (req.body.unlike) {
                const unlike = req.body.unlike;
                user.feedAction[feedIndex].unlikeTime.push(unlike);
                user.feedAction[feedIndex].liked = false;
                user.numPostLikes--;
            }
            // User read the post.
            else if (req.body.viewed) {
                const view = req.body.viewed;
                user.feedAction[feedIndex].readTime.push(view);
                user.feedAction[feedIndex].rereadTimes++;
                user.feedAction[feedIndex].mostRecentTime = Date.now();
            } else {
                console.log('Something in feedAction went crazy. You should never see this.');
            }
        }
        saved = await user.save();
        res.send({ result: "success", numComments: user.numComments });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /userPost_feed/
 * Record user's actions on USER posts. 
 */
exports.postUpdateUserPostFeedAction = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id).exec();
        // Find the index of object in user.posts
        let feedIndex = _.findIndex(user.posts, function (o) { return o.postID == req.body.postID; });

        if (feedIndex == -1) {
            // Should not happen.
        }
        // User created a new comment on the post.
        else if (req.body.new_comment) {
            user.numComments = user.numComments + 1;
            const cat = {
                body: req.body.comment_text,
                commentID: user.numComments,
                relativeTime: req.body.new_comment - user.createdAt,
                absTime: req.body.new_comment,
                new_comment: true,
                liked: false,
                flagged: false,
                likes: 0
            };
            user.posts[feedIndex].comments.push(cat);

            // Check if user is mentioning anyone 
            let mentioned = cat.body.match(/@\w+/);

            // If a match is found, make a new comment accordingly
            if (mentioned) {
                mentioned = mentioned[0].substring(1);
                let AIActor = await Actor.findOne({ username: mentioned });
                // Call for a new comment
                await user.save();
                const post = user.posts[feedIndex]
                const AIResponse = await getResponse(post, user, AIActor);
                const new_reply = {
                    commentID: post.comments.length,
                    body: `@${user.username} ` + AIResponse,
                    likes: 0,
                    actor: AIActor,
                    userID: user._id,
                    relativeTime: cat.relativeTime + 60000,
                    absTime: new Date(user.createdAt.getTime() + cat.relativeTime + timeStringToNum("0:01")),
                    class: "",
                    new_comment: false,
                    liked: false,
                };
                user.posts[feedIndex].comments.push(new_reply);
                try {
                    await user.save();
                } catch (err) {
                    console.log(err);
                    next(err);
                }
                // create a new notification object corresponding to the post
                const notifdetails = {
                    key: 'reply_reply',
                    actor: AIActor,
                    notificationType: 'reply',
                    userID: user._id,
                    userReplyID: user.numComments,
                    time: timeStringToNum("0:01"),
                    postID: user.posts[feedIndex]._id,
                    replyBody: AIResponse,
                    class: "",

                };
                const newnotif = new Notification(notifdetails);
                try {
                    await newnotif.save();
                } catch (err) {
                    console.log(err);
                    next(err);
                }
            }

        }
        // User interacted with a comment on the post.
        else if (req.body.commentID) {
            const commentIndex = _.findIndex(user.posts[feedIndex].comments, function (o) {
                return o.commentID == req.body.commentID && o.new_comment == (req.body.isUserComment == 'true');
            });
            if (commentIndex == -1) {
                console.log("Should not happen.");
            }
            // User liked the comment.
            else if (req.body.like) {
                user.posts[feedIndex].comments[commentIndex].liked = true;
            }
            // User unliked the comment. 
            else if (req.body.unlike) {
                user.posts[feedIndex].comments[commentIndex].liked = false;
            }
            // User flagged the comment.
            else if (req.body.flag) {
                user.posts[feedIndex].comments[commentIndex].flagged = true;
            }
        }
        // User interacted with the post. 
        else {
            // User liked the post.
            if (req.body.like) {
                user.posts[feedIndex].liked = true;
            }
            // User unliked the post.
            if (req.body.unlike) {
                user.posts[feedIndex].liked = false;
            }
        }
        await user.save();
        res.send({ result: "success", numComments: user.numComments });
    } catch (err) {
        next(err);
    }
}