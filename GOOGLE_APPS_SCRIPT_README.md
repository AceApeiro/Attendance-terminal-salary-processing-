# Google Apps Script Setup Guide

The AI Studio Applet handles the user interface, taking photos, getting location, calculating shift hours, and managing the live database. The app sends all this data securely to your Google Apps Script webhook.

To save this data to Google Sheets and save images to Google Drive, open your Google Sheets, click **Extensions > Apps Script**, and replace your current `Code.gs` with the following:

```js
// Replace these with your actual Drive Folder ID and Sheet tab names
const DRIVE_FOLDER_ID = "YOUR_GOOGLE_DRIVE_PHOTOS_FOLDER_ID_HERE";
const LOGS_SHEET_NAME = "Raw Logs"; 
const SUMMARY_SHEET_NAME = "Attendance Summary";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Save Image to Google Drive
    let imageUrl = "No Image";
    if (data.image && data.image.includes("base64,")) {
      try {
        const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
        const base64Data = data.image.split("base64,")[1];
        // Decode base64 to blob
        const decoded = Utilities.base64Decode(base64Data);
        // Cleanse the filename of any invalid characters
        const safeUserName = data.userName ? data.userName.replace(/[^a-z0-9]/gi, '_').toLowerCase() : "user";
        const blob = Utilities.newBlob(decoded, "image/jpeg", safeUserName + "_" + new Date().getTime() + ".jpg");
        const file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        imageUrl = file.getUrl();
      } catch (imgError) {
        // Log image upload failure but don't fail the entire script
        imageUrl = "Image Error: " + imgError.toString();
      }
    }
    
    // 2. Append Raw Log
    const logsSheet = ss.getSheetByName(LOGS_SHEET_NAME) || ss.insertSheet(LOGS_SHEET_NAME);
    logsSheet.appendRow([
      data.seqId,
      new Date(data.timestamp),
      data.userId,
      data.userName,
      data.type, // Time In or Time Out
      data.latitude,
      data.longitude,
      data.locationName,
      data.isFlagged ? "FLAGGED" : "OK",
      imageUrl
    ]);
    
    // 3. Update Summary Sheet (7 AM to 7 AM Next Day Logic)
    const summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME) || ss.insertSheet(SUMMARY_SHEET_NAME);
    
    // Calculate logical shift date (shift back 7 hours)
    const dateObj = new Date(data.timestamp);
    const logicalDateObj = new Date(dateObj.getTime() - 7 * 60 * 60 * 1000);
    const shiftDateStr = Utilities.formatDate(logicalDateObj, Session.getScriptTimeZone(), "yyyy-MM-dd");
    
    const uniqueKey = data.userId + "_" + shiftDateStr;
    
    // Check if this shift date & user already exist in the summary
    const summaryData = summarySheet.getDataRange().getValues();
    let rowToUpdate = -1;
    
    // Assuming Column A is UniqueKey, B is Date, C is User ID, D is Name, E is Time In, F is Time Out, G is Hours Worked
    for (let i = 1; i < summaryData.length; i++) {
      if (summaryData[i][0] === uniqueKey) {
        rowToUpdate = i + 1; // +1 because Arrays are 0-indexed, rows are 1-indexed
        break;
      }
    }
    
    if (rowToUpdate === -1) {
      // Create new summary row (Time In)
      summarySheet.appendRow([
        uniqueKey,
        shiftDateStr,
        data.userId,
        data.userName,
        data.type === 'Time In' ? new Date(data.timestamp) : "", // Time In
        data.type === 'Time Out' ? new Date(data.timestamp) : "", // Time Out
        data.hoursWorked || ""
      ]);
    } else {
      // Update existing summary row (Time Out)
      if (data.type === 'Time Out') {
        summarySheet.getRange(rowToUpdate, 6).setValue(new Date(data.timestamp)); // Update Time Out
        summarySheet.getRange(rowToUpdate, 7).setValue(data.hoursWorked); // Update Hours
      } else {
        summarySheet.getRange(rowToUpdate, 5).setValue(new Date(data.timestamp)); // Update Time In
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({"status": "success"}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

### Next Steps to Deploy:
1. Paste the script into your Google Sheet's Apps Script editor.
2. Put the Folder ID of your empty Drive folder where images will go.
3. Click "Deploy > New Deployment" as a **Web App**, set *Execute as: Me*, and *Who has access: Anyone*.
4. Authorize the permissions (it will ask for Drive and Sheets access). 
5. Replace the `VITE_GOOGLE_WEBHOOK_URL` in your `.env` file (if you have one) or in the app's `server.ts` file if you are using it there.
