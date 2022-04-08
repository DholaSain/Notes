const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
var db = admin.firestore();
var fcm = admin.messaging();

exports.newMessageNotification = functions.firestore
  .document("messages/{chatId}/messages/{messagesId}")
  .onCreate(async (snap, context) => {
    const newValue = snap.data();

    const message = newValue.text;
    console.log(`Message is: ${message}`);

    const receiverId = newValue.sendTo;
    // const receiverId = members.filter((a) => a !== newValue.sentBy)[0];

    const userData = await db.collection("users").doc(receiverId).get();
    const userValues = userData.data();
    const token = userValues.fcmToken;

    console.log(`Name: ${userValues.firstName + " " + userValues.lastName}`);
    console.log(`token: ${token}`);

    if (token != "") {
      const payload = {
        notification: {
          title: `Message by ${userValues.firstName}`,
          body: message,
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
          },
          data: {
            chatId: newValue.chatId,
            sendTo: receiverId,
          }
      };
      console.log("Notification sent");

      return fcm.sendToDevice(token, payload);
    }
    return;
  });
