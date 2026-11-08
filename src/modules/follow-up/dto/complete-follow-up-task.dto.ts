import { FollowUpAnswer } from '../follow-up.constants';

export class CompleteFollowUpTaskDto {
  callRecordId!: string;
  answer!: FollowUpAnswer;
  answerBusinessId?: string;
  notes?: string;
}
