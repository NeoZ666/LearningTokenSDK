const { Builder, By, until, logging } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const baseUrl = 'https://api.zoom.us/v2';
const regex = /(?:\d{2}:\d{2}:\d{2}\s+)?([A-Za-z\s]+)(?::|I am).*?(?:(?:LT[\s-]?ID(?:\s+is)?[\s:]+([A-Za-z0-9-]+))|(?:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})))/gms;

async function getZoomChatDownloadUrl(meetingId, bearerToken) {
  try {
    const response = await axios.get(`${baseUrl}/meetings/${meetingId}/recordings?file_type=chat`, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json'
      }
    });

    const chatFile = response.data.recording_files.find(file => file.file_type === 'CHAT');
    if (!chatFile) {
      throw new Error('Chat file not found in the response');
    }

    return {
      URL: chatFile.download_url,
      PASS: response.data.password
    };
  } catch (error) {
    console.error('Error fetching Zoom chat download URL:', error.message);
    throw error;
  }
}

async function downloadZoomChat(meetingId, bearerToken) {
  const { URL: url, PASS: pass } = await getZoomChatDownloadUrl(meetingId, bearerToken);
  const downloadPath = path.resolve(__dirname, 'downloads');

  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath);
  }

  const chromeOptions = new chrome.Options();
  chromeOptions.setUserPreferences({
    'download.default_directory': downloadPath,
    'safebrowsing.enabled': true,
  });

  chromeOptions.set('goog:loggingPrefs', { performance: 'ALL' });

  const driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(chromeOptions.addArguments('--headless=new'))
    .build();

  try {
    await driver.get(url);

    const passcodeInput = await driver.wait(until.elementLocated(By.id('passcode')), 90000);
    await passcodeInput.sendKeys(pass);

    const submitButton = await driver.findElement(By.id('passcode_btn'));
    await submitButton.click();

    const logs = await driver.manage().logs().get(logging.Type.PERFORMANCE);
    fs.writeFileSync('logs.json', JSON.stringify(logs, null, 2));

    for (let logEntry of logs) {
      const message = JSON.parse(logEntry.message).message;
      if (message.method === 'Network.responseReceived' && message.params.response.status === 200) {
        const downloadUrl = message.params.response.url;
        if (downloadUrl.includes('rec/download')) {
          console.log('Download URL:', downloadUrl);
        }
      }
    }

    setTimeout(() => {
      fs.readdir(downloadPath, (err, files) => {
        if (err) {
          console.error('Error reading downloads directory:', err);
          return;
        }

        if (files.length === 0) {
          console.log('No files downloaded.');
        } else {
          files.forEach(file => {
            console.log('Downloaded file:', file);

            const fileContent = fs.readFileSync(path.join(downloadPath, file), 'utf-8');
            console.log("\nFile contents:");
            console.log(fileContent);

            const nameMap = {};
            let match;

            while ((match = regex.exec(fileContent)) !== null) {
              const name = match[1].trim();
              const LTId = match[2] ? match[2].trim() : "";
              const email = match[3] ? match[3].trim() : "";

              nameMap[name] = {
                LTId,
                Email: email
              };
            }

            if (Object.keys(nameMap).length > 0) {
              console.log("\nExtracted names and emails:");
              console.log(nameMap);

              fs.writeFileSync(path.join(downloadPath, `${meetingId}.json`), JSON.stringify(nameMap, null, 2));
              fs.renameSync(path.join(downloadPath, file), path.join(downloadPath, `${meetingId}.txt`));
            } else {
              console.log("No names or email addresses found.");
            }
          });
        }
      });

      setTimeout(async () => {
        await driver.quit();
      }, 30000);
    }, 30000);
  } catch (err) {
    console.error('An error occurred:', err);
  }
}

module.exports = { downloadZoomChat };
