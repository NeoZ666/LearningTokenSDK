import express, { Express, Request, Response } from 'express';
import axios, { AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const app: Express = express();
const port = 3000;

interface ZoomParticipant {
  id: string;
  name: string;
  user_email: string;
  join_time: string;
  leave_time: string;
}

interface ZoomParticipantsResponse {
  participants: ZoomParticipant[];
  page_count: number;
  page_size: number;
  total_records: number;
}

// Comes from /meetings/:meetingId/polls
interface ZoomPollsQuestion {
  total_records: number;
  polls: PollQuestions[];
}

interface PollQuestions {
  id: string;
  title: string;
  anonymous: boolean;
  status: string;
  questions: Pollquestion[];
  poll_type: number;
}

interface Pollquestion {
  name: string;
  type: string;
  answer_required: boolean;
  answer_min_character?: number;
  answer_max_character?: number;
  answers?: string[];
  right_answers?: string[];
  prompts?: {
    prompt_question: string;
    prompt_right_answers?: string[];
  }[];
  show_as_dropdown?: boolean;
  rating_min_value?: number;
  rating_max_value?: number;
  rating_min_label?: string;
  rating_max_label?: string;
  case_sensitive?: boolean;
}

// Comes from /past_meetings/:meetingId/polls
interface ZoomPollsResponse {
  id: number;
  uuid: string;
  start_time: string;
  questions: ResponseToQuestion[];
}

interface ResponseToQuestion {
  name: string;
  email: string;
  question_details: ResponseQuestionDetail[];
  first_name: string;
}

interface ResponseQuestionDetail {
  question: string;
  answer: string;
  polling_id: string;
  date_time: string;
}

interface ParticipantScore {
  name: string;
  total_score: number;
  attempted: number;
  total_questions: number;
}

interface Scores {
  title: string;
  question: string;
  score: number;
}

interface ApiResponse<T> {
  data: T;
  status: number;
  statusText: string;
}

interface EmailMap {
  [key: string]: {
    LTId: string;
    Email: string;
  };
}

interface ParticipantData {
  totalTime: number;
  joinTime: number;
  leaveTime: number;
  email: string;
  LTId: string;
  pollAnswers: ParticipantScore[];
  // engagement: Engagement[];
}

// interface Engagement {
//   chat: string
// }

async function getPastMeetingParticipants(
  baseUrl: string,
  meetingId: string,
  bearerToken: string
): Promise<ApiResponse<ZoomParticipantsResponse>> {
  try {
    const url = `${baseUrl}/past_meetings/${meetingId}/participants`;
    const response: AxiosResponse<ZoomParticipantsResponse> = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
    });
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message || error.message);
    } else {
      throw new Error('An unknown error occurred');
    }
  }
}

async function getMeetingPollsQuestions(
  baseUrl: string,
  meetingId: string,
  bearerToken: string
): Promise<ApiResponse<ZoomPollsQuestion>> {
  try {
    const url = `${baseUrl}/meetings/${meetingId}/polls`;
    const response: AxiosResponse<ZoomPollsQuestion> = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
    });
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error: any) {
    throw new Error(error.response?.data?.message || error.message);
  }
}

async function getPastMeetingPolls(
  baseUrl: string,
  meetingId: string,
  bearerToken: string
): Promise<ApiResponse<ZoomPollsResponse>> {
  try {
    const url = `${baseUrl}/past_meetings/${meetingId}/polls`;
    const response = await axios.get<ZoomPollsResponse>(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error: any) {
    throw new Error(error.response?.data?.message || error.message);
  }
}

function readEmailMappings(filePath: string): EmailMap {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading email mappings:', error);
    return {};
  }
}

function processParticipantsAndPollsData(
  participants: ZoomParticipant[],
  pollScores: ParticipantScore[],
  emailMappings: EmailMap,
  chatContent: string
): { participantMap: Map<string, ParticipantData>, engagement: string } {
  const participantMap = new Map<string, ParticipantData>();

  // Process participants to calculate total time and map email and LTId
  participants.forEach(participant => {
    const name = participant.name;
    const joinTime = new Date(participant.join_time).getTime();
    const leaveTime = new Date(participant.leave_time).getTime();
    const duration = (leaveTime - joinTime) / 1000; // Convert to seconds

    const mappingData = emailMappings[name] || { Email: participant.user_email || 'NaN', LTId: 'NaN' };

    if (participantMap.has(name)) {
      participantMap.get(name)!.totalTime += duration;
    } else {
      participantMap.set(name, {
        totalTime: duration,
        joinTime: joinTime,
        leaveTime: leaveTime,
        email: mappingData.Email,
        LTId: mappingData.LTId,
        pollAnswers: []
      });
    }
  });

  // Process poll scores and connect them with participant data
  pollScores.forEach(person => {
    const participantData = participantMap.get(person.name);
    if (participantData) {
      participantData.pollAnswers.push(person);
    }
  });

  return { participantMap, engagement: chatContent };
}

function saveProcessedDataToFile(
  data: { participantMap: Map<string, ParticipantData>, engagement: string },
  outputPath: string,
  meetingId: string,
): any {
  const processedData = {
    // engagement: data.engagement,
    meetingId: meetingId,
    attendees: Array.from(data.participantMap.entries()).map(([name, participantData]) => ({
      name,
      totalTime: participantData.totalTime,
      joinTime: participantData.joinTime,
      leaveTime: participantData.leaveTime,
      email: participantData.email,
      LTId: participantData.LTId,
      pollAnswers: participantData.pollAnswers.map(answer => ({
        total_score: answer.total_score,
        attempted: answer.attempted,
        total_questions: answer.total_questions,
      }))
    }))
  };

  fs.writeFileSync(outputPath, JSON.stringify(processedData, null, 2));
  console.log(`Processed data has been saved to ${outputPath}`);
  return processedData;
}

// POLLS ANSWER CALCULATION 

function calculateScore(pollsQuestionsResponse: ZoomPollsQuestion, pollsAnswers: ZoomPollsResponse): ParticipantScore[] {
  // Initialize a participantScores array
  const participantScores: ParticipantScore[] = [];

  // Iterate over participants in pollAnswers
  pollsAnswers.questions.forEach((participant) => {
    const participantScore: ParticipantScore = {
      name: participant.name,
      // poll_scores: [],
      total_score: 0,
      total_questions: 0,
      attempted: 0
    };

    // Iterate over the participant's answers
    participant.question_details.forEach((responseDetail) => {
      const pollQuestion = pollsQuestionsResponse.polls.find(poll => poll.id === responseDetail.polling_id);

      if (pollQuestion) {

        const question = pollQuestion.questions.find(q => q.name == responseDetail.question);
        const scoreObj: Scores = {
          title: pollQuestion.title,
          question: question?.name || 'Default',
          score: 0
        };

        if (question) {
          participantScore.attempted++;  // Increment attempted for every question

          if (!question.right_answers) {
            // Case 1: If no answer is required, increment score and total
            scoreObj.score++;
            participantScore.total_score++;
          } else {
            // Case 2: If an answer exists, compare it with the right answer
            if (question.right_answers.includes(responseDetail.answer)) {
              scoreObj.score++;  // Increment score if the answer is correct
              participantScore.total_score++;  // Increment total score
            }
          }
        }
        participantScore.total_questions = participantScore.attempted;

        // Add the score object for this particular poll
        // participantScore.poll_scores.push(scoreObj);
      }
    });

    // Push the calculated participant score to the array
    participantScores.push(participantScore);
  });

  // Return the participantScores array
  return participantScores;
}

app.get('/fetch-and-process-data', async (req, res) => {
  const baseUrl = "https://api.zoom.us/v2";
   const meetingId = process.env.MEETING_ID || "82339006452";
  const bearerToken = process.env.BEARER_TOKEN || "eyJzdiI6IjAwMDAwMSIsImFsZyI6IkhTNTEyIiwidiI6IjIuMCIsImtpZCI6Ijg3NmE0Njk0LTkzMmEtNDJmZC04NDc2LTRiYTNhNDIwMjA0MiJ9.eyJhdWQiOiJodHRwczovL29hdXRoLnpvb20udXMiLCJ1aWQiOiIyZE5QTlpldVNUV1NtX212NG1BWGFnIiwidmVyIjoxMCwiYXVpZCI6IjcxYzlmZDZhMGYxMmJiZDU2MDAzOGU1YmVjNTU2OWUxZGI0YjczMDYyY2E5N2JmNDZiNTNjNjljMTk0MGFlNjYiLCJuYmYiOjE3MzA4MjMxMjUsImNvZGUiOiJVTGkzNXRMVlNrV0RGUFI4dkZtM3ZBREZUVEcybDhQcmwiLCJpc3MiOiJ6bTpjaWQ6YlJCZ0JTbEhSVE84aTdZUEZjd0JmdyIsImdubyI6MCwiZXhwIjoxNzMwODI2NzI1LCJ0eXBlIjozLCJpYXQiOjE3MzA4MjMxMjUsImFpZCI6ImpoRExrS2UtUkpxdzF2RDQ3dXdiX3cifQ.K2DRE94zoDdHp-lZjnTGH2YKCs7e01HqTIcX2r7ZYDyL8Ot4yv8HfjSKBHOWK3V3RO021QZYaBAtMlpA7Eur2w";
  const emailMappingsPath = path.join(__dirname, 'downloads', 'LT_82258262218.json');
  const chatPath = path.join(__dirname, 'downloads', '82258262218.txt');
  const outputPath = path.join(__dirname, 'processed_data.json');

  try {
    // Fetch participants
    const participantsResponse = await getPastMeetingParticipants(baseUrl, meetingId, bearerToken);
    const participants = participantsResponse.data.participants;

    // Fetch poll questions
    const pollsQuestionResponse = await getMeetingPollsQuestions(baseUrl, meetingId, bearerToken);
    const pollQuestionsResponse = pollsQuestionResponse.data;

    // Fetch poll answers
    const pollAnswersResponse = await getPastMeetingPolls(baseUrl, meetingId, bearerToken);
    const pollAnswers = pollAnswersResponse.data;

    // Read email mappings
    const emailMappings = readEmailMappings(emailMappingsPath);

    // Read chat
    const chatContent = fs.readFileSync(chatPath, 'utf-8');

    // Calculate scores
    const pollScores = calculateScore(pollQuestionsResponse, pollAnswers);

    // Process participants and poll data
    const participantMap = processParticipantsAndPollsData(participants, pollScores, emailMappings, chatContent);

    // Save processed data to file
    const processedData = saveProcessedDataToFile(participantMap, outputPath, meetingId);

    res.status(200).json(processedData);
  } catch (error) {
    console.error('Error fetching and processing data:', error);
    res.status(500).send('An error occurred while fetching and processing data.');
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});