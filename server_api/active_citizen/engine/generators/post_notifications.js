var models = require("../../../models");
var auth = require('../../authorization');
var log = require('../../utils/logger');
var toJson = require('../../utils/to_json');
var async = require('async');
var getModelAndUsersByType = require('./notifications_utils').getModelAndUsersByType;
var addNotificationsForUsers = require('./notifications_utils').addNotificationsForUsers;

var generateNotificationsForNewIdea = function (activity, uniqueUserIds, callback) {
  async.series([
    function(seriesCallback){
      if (activity.Community) {
        // Notifications for all new posts in community
        getModelAndUsersByType(models.Community, 'CommunityUsers', activity.Community.id, "all_community", function(error, community) {
          if (error) {
            seriesCallback(error);
          } else {
            addNotificationsForUsers(activity, community.CommunityUsers, "notification.post.new", uniqueUserIds, seriesCallback);
          }
        });
      } else {
        seriesCallback();
      }
    },
    function(seriesCallback){
      // Notifications for all new posts in group
      getModelAndUsersByType(models.Group, 'GroupUsers', activity.Group.id, "all_group", function(error, group) {
        if (error) {
          seriesCallback(error);
        } else {
          addNotificationsForUsers(activity, group.GroupUsers, "notification.post.new", uniqueUserIds, seriesCallback);
        }
      });
    }
  ], function (error) {
    callback(error);
  });

  // TODO: Add AcWatching community and group users
};

var generateNotificationsForEndorsements = function (activity, callback) {
  // Notifications for endorsement on posts I've created
  models.Post.find({
    where: { id: activity.post_id },
    include: [
      {
        model: models.User,
        required: true,
        where: {
          "notifications_settings.my_posts_endorsements.method": {
            $gt: 0
          }
        }
      }
    ]
  }).then( function(post) {
    if (post) {
      models.AcNotification.find({
        where: {
          user_id: post.User.id,
          type: 'notification.post.endorsement',
          created_at: {
            $lt: new Date(),
            $gt: new Date(new Date() - models.AcNotification.ENDORSEMENT_GROUPING_TTL)
          }
        }
      }).then(function(notification) {
        if (notification) {
          models.AcNotification.find({
            where: {
              user_id: post.User.id,
              type: 'notification.post.endorsement',
              created_at: {
                $lt: new Date(),
                $gt: new Date(new Date() - models.AcNotification.ENDORSEMENT_GROUPING_TTL)
              }
            },
            include: [
              {
                model: models.AcActivity,
                as: 'AcActivities',
                required: true,
                where: {
                  user_id: activity.user_id,
                  type: activity.type
                }
              }
            ]
          }).then(function(specificNotification) {
            if (specificNotification) {
              callback();
            } else {
              notification.addAcActivities(activity).then(function (results) {
                if (results) {
                  models.AcNotification.processNotification(notification, activity);
                  callback();
                } else {
                  callback("Notification Error Can't add activity");
                }
              });
            }
          });
        } else {
          models.AcNotification.createNotificationFromActivity(post.User, activity, 'notification.post.endorsement', 50, function (error) {
            callback(error);
          });
        }
      });
    } else {
      callback('Not found or muted');
    }
  }).catch(error, function() {
    callback(error);
  });

  // TODO: Add AcWatching users
};

module.exports = function (activity, user, callback) {

  // Make sure not to create duplicate notifications to the same user
  var uniqueUserIds = {};

  if (activity.type=='activity.post.new') {
    generateNotificationsForNewIdea(activity, uniqueUserIds, callback);
  } else if (activity.type=='activity.post.endorsement.new' || activity.type=='activity.post.opposition.new') {
    generateNotificationsForEndorsements(activity, callback)
  }
};
