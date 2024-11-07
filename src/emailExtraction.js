const { Builder, By, until, logging } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const baseUrl = 'https://api.zoom.us/v2';
const meetingId = 82339006452;
const DEFAULT_BEARER_TOKEN = "eyJzdiI6IjAwMDAwMSIsImFsZyI6IkhTNTEyIiwidiI6IjIuMCIsImtpZCI6Ijg4NDk2MGI5LTU1NmUtNGY1OS1hYjE2LTAxNjQwMjc2ZTU2MyJ9.eyJhdWQiOiJodHRwczovL29hdXRoLnpvb20udXMiLCJ1aWQiOiIyZE5QTlpldVNUV1NtX212NG1BWGFnIiwidmVyIjoxMCwiYXVpZCI6IjcxYzlmZDZhMGYxMmJiZDU2MDAzOGU1YmVjNTU2OWUxZGI0YjczMDYyY2E5N2JmNDZiNTNjNjljMTk0MGFlNjYiLCJuYmYiOjE3MzA4MTIwMTcsImNvZGUiOiJWX1ZGWE1MOVRDNmFtX3AyTWRzTVJncFQ2VkZEaE41MW0iLCJpc3MiOiJ6bTpjaWQ6YlJCZ0JTbEhSVE84aTdZUEZjd0JmdyIsImdubyI6MCwiZXhwIjoxNzMwODE1NjE3LCJ0eXBlIjozLCJpYXQiOjE3MzA4MTIwMTcsImFpZCI6ImpoRExrS2UtUkpxdzF2RDQ3dXdiX3cifQ.qOmC9j0f0_4Y073_koRMGcxGovQzxFSoJ-J3n9vBi1xesLDJd8HB_mkaneaAqNZxL4ZI_qD9Ib2gVzywS2S0fA";

async function getZoomChatDownloadUrl() {
  try {
    const response = await axios.get(`${baseUrl}/meetings/${meetingId}/recordings?file_type=chat`, {
      headers: {
        'Authorization': `Bearer ${DEFAULT_BEARER_TOKEN}`,
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

const regex = /(?:\d{2}:\d{2}:\d{2}\s+)?([A-Za-z\s]+)(?::|I am).*?(?:(?:LT[\s-]?ID(?:\s+is)?[\s:]+([A-Za-z0-9-]+))|(?:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})))/gms;

(async () => {
  const { URL: url, PASS: pass } = await getZoomChatDownloadUrl();
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
})();