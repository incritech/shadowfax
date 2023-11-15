import { LoaderFunction } from 'react-router-dom';

import { database } from '../../common/database';
import { SCRATCHPAD_ORGANIZATION_ID } from '../../models/organization';
import { Project } from "../../models/project";

export interface LoaderData {
  untrackedProjects: (Project & { workspacesCount: number })[];
}

export const loader: LoaderFunction = async () => {
  const projects = await database.find<Project>("Project", {
    parentId: { $nin: [SCRATCHPAD_ORGANIZATION_ID] },
  });

  const untrackedProjects = [];

  for (const project of projects) {
    const workspacesCount = await database.count("Workspace", {
      parentId: project._id,
    });

    untrackedProjects.push({
      ...project,
      workspacesCount,
    });
  }

  return {
    untrackedProjects,
  };
};
