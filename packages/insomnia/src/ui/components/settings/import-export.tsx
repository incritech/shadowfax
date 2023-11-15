import React, { FC, Fragment, useEffect, useState } from 'react';
import { Button, Heading, Item, ListBox, Popover, Select, SelectValue } from 'react-aria-components';
import { useFetcher, useParams } from 'react-router-dom';
import { useRouteLoaderData } from 'react-router-dom';

import { isLoggedIn } from '../../../account/session';
import { getProductName } from '../../../common/constants';
import { exportProjectToFile } from '../../../common/export';
import { exportAllData } from '../../../common/export-all-data';
import { getWorkspaceLabel } from '../../../common/get-workspace-label';
import { strings } from '../../../common/strings';
import { isScratchpadOrganizationId, Organization } from '../../../models/organization';
import { Project } from '../../../models/project';
import { isScratchpad } from "../../../models/workspace";
import { ProjectLoaderData } from "../../routes/project";
import { useRootLoaderData } from "../../routes/root";
import { LoaderData } from "../../routes/untracked-projects";
import { WorkspaceLoaderData } from "../../routes/workspace";
import {
  Dropdown,
  DropdownItem,
  DropdownSection,
  ItemContent,
} from "../base/dropdown";
import { Icon } from "../icon";
import { showAlert } from "../modals";
import { ExportRequestsModal } from "../modals/export-requests-modal";
import { ImportModal } from "../modals/import-modal";

const UntrackedProject = ({
  project,
}: {
  project: Project & { workspacesCount: number };
}) => {
  return (
    <div
      key={project._id}
      className="flex items-center gap-2 justify-between py-2"
    >
      <div className="flex flex-col gap-1">
        <Heading className="text-base font-semibold flex items-center gap-2">
          {project.name}
          <span className="text-xs text-[--hl]">Id: {project._id}</span>
        </Heading>
        <p className="text-sm">
          This project contains {project.workspacesCount}{" "}
          {project.workspacesCount === 1 ? "file" : "files"}.
        </p>
      </div>
    </div>
  );
};

interface Props {
  hideSettingsModal: () => void;
}

export const ImportExport: FC<Props> = ({ hideSettingsModal }) => {
  const { organizationId, projectId, workspaceId } = useParams() as {
    organizationId: string;
    projectId: string;
    workspaceId?: string;
  };

  const untrackedProjectsFetcher = useFetcher<LoaderData>();

  useEffect(() => {
    const isIdleAndUninitialized =
      untrackedProjectsFetcher.state === "idle" &&
      !untrackedProjectsFetcher.data;
    if (isIdleAndUninitialized) {
      untrackedProjectsFetcher.load("/untracked-projects");
    }
  }, [untrackedProjectsFetcher, organizationId]);

  const untrackedProjects =
    untrackedProjectsFetcher.data?.untrackedProjects || [];

  const workspaceData = useRouteLoaderData(":workspaceId") as
    | WorkspaceLoaderData
    | undefined;
  const activeWorkspaceName = workspaceData?.activeWorkspace.name;
  const { workspaceCount } = useRootLoaderData();
  const workspacesFetcher = useFetcher();
  useEffect(() => {
    const isIdleAndUninitialized =
      workspacesFetcher.state === "idle" && !workspacesFetcher.data;
    if (
      isIdleAndUninitialized &&
      organizationId &&
      !isScratchpadOrganizationId(organizationId)
    ) {
      workspacesFetcher.load(
        `/organization/${organizationId}/project/${projectId}`
      );
    }
  }, [organizationId, projectId, workspacesFetcher]);
  const projectLoaderData = workspacesFetcher?.data as
    | ProjectLoaderData
    | undefined;
  const workspacesForActiveProject =
    projectLoaderData?.workspaces.map((w) => w.workspace) || [];
  const projectName = projectLoaderData?.activeProject.name ?? getProductName();

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const handleExportProjectToFile = () => {
    exportProjectToFile(projectName, workspacesForActiveProject);
    hideSettingsModal();
  };

  if (!organizationId) {
    return null;
  }

  return (
    <Fragment>
      <div data-testid="import-export-tab" className="flex flex-col gap-4">
        <div className="rounded-md border border-solid border-[--hl-md] p-4 flex flex-col gap-2">
          <Heading className="text-lg font-bold flex items-center gap-2">
            <Icon icon="file-export" /> Export
          </Heading>
          <div className="flex gap-2 flex-wrap">
            {workspaceData?.activeWorkspace ? (
              isScratchpad(workspaceData.activeWorkspace) ? (
                <Button
                  className="px-4 py-1 font-semibold border border-solid border-[--hl-md] flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] rounded-sm text-[--color-font] hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all text-sm"
                  onPress={() => setIsExportModalOpen(true)}
                >
                  Export the "{activeWorkspaceName}"{" "}
                  {getWorkspaceLabel(workspaceData.activeWorkspace).singular}
                </Button>
              ) : (
                <Dropdown
                  aria-label="Export Data Dropdown"
                  triggerButton={
                    <Button className="px-4 py-1 font-semibold border border-solid border-[--hl-md] flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] rounded-sm text-[--color-font] hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all text-sm">
                      Export Data <i className="fa fa-caret-down" />
                    </Button>
                  }
                >
                  <DropdownSection
                    aria-label="Choose Export Type"
                    title="Choose Export Type"
                  >
                    <DropdownItem
                      aria-label={`Export the "${activeWorkspaceName}" ${
                        getWorkspaceLabel(workspaceData.activeWorkspace)
                          .singular
                      }`}
                    >
                      <ItemContent
                        icon="home"
                        label={`Export the "${activeWorkspaceName}" ${
                          getWorkspaceLabel(workspaceData.activeWorkspace)
                            .singular
                        }`}
                        onClick={() => setIsExportModalOpen(true)}
                      />
                    </DropdownItem>
                    <DropdownItem
                      aria-label={`Export files from the "${projectName}" ${strings.project.singular}`}
                    >
                      <ItemContent
                        icon="empty"
                        label={`Export files from the "${projectName}" ${strings.project.singular}`}
                        onClick={handleExportProjectToFile}
                      />
                    </DropdownItem>
                  </DropdownSection>
                </Dropdown>
              )
            ) : (
              <Button
                className="px-4 py-1 font-semibold border border-solid border-[--hl-md] flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] rounded-sm text-[--color-font] hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all text-sm"
                onPress={handleExportProjectToFile}
              >
                {`Export files from the "${projectName}" ${strings.project.singular}`}
              </Button>
            )}
            <Button
              className="px-4 py-1 font-semibold border border-solid border-[--hl-md] flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] rounded-sm text-[--color-font] hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all text-sm"
              onPress={async () => {
                const { filePaths, canceled } =
                  await window.dialog.showOpenDialog({
                    properties: [
                      "openDirectory",
                      "createDirectory",
                      "promptToCreate",
                    ],
                    buttonLabel: "Select",
                    title: "Export All Insomnia Data",
                  });

                if (canceled) {
                  return;
                }

                const [dirPath] = filePaths;

                try {
                  dirPath &&
                    (await exportAllData({
                      dirPath,
                    }));
                } catch (e) {
                  showAlert({
                    title: "Export Failed",
                    message:
                      "An error occurred while exporting data. Please try again.",
                  });
                  console.error(e);
                }

                showAlert({
                  title: "Export Complete",
                  message: "All your data have been successfully exported",
                });
              }}
              aria-label="Export all data"
            >
              <Icon icon="file-export" />
              <span>Export all data {`(${workspaceCount} files)`}</span>
            </Button>

            <Button
              className="px-4 py-1 font-semibold border border-solid border-[--hl-md] flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] rounded-sm text-[--color-font] hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all text-sm"
              isDisabled={!isLoggedIn()}
              onPress={() =>
                window.main.openInBrowser(
                  "https://insomnia.rest/create-run-button"
                )
              }
            >
              <i className="fa fa-file-import" />
              Create Run Button
            </Button>
          </div>
        </div>
        <div className="rounded-md border border-solid border-[--hl-md] p-4 flex flex-col gap-2">
          <Heading className="text-lg font-bold flex items-center gap-2">
            <Icon icon="file-import" /> Import
          </Heading>
          <div className="flex gap-2 flex-wrap">
            <Button
              className="px-4 py-1 font-semibold border border-solid border-[--hl-md] flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] rounded-sm text-[--color-font] hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all text-sm"
              isDisabled={
                workspaceData?.activeWorkspace &&
                isScratchpad(workspaceData?.activeWorkspace)
              }
              onPress={() => setIsImportModalOpen(true)}
            >
              <Icon icon="file-import" />
              {`Import to the "${projectName}" ${strings.project.singular}`}
            </Button>
          </div>
        </div>
        {untrackedProjects.length > 0 && (
          <div className="rounded-md border border-solid border-[--hl-md] p-4 flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <Heading className="text-lg font-bold flex items-center gap-2">
                <Icon icon="cancel" /> Untracked projects (
                {untrackedProjects.length})
              </Heading>
              <p className="text-[--hl] text-sm">
                <Icon icon="info-circle" /> These projects are not associated
                with any organization in your account. You can move them to an
                organization below.
              </p>
            </div>
            <div className="flex flex-col gap-1 overflow-y-auto divide-y divide-solid divide-[--hl-md]">
              {untrackedProjects.map((project) => (
                <UntrackedProject key={project._id} project={project} />
              ))}
            </div>
          </div>
        )}
      </div>
      {isImportModalOpen && (
        <ImportModal
          onHide={() => setIsImportModalOpen(false)}
          from={{ type: "file" }}
          projectName={projectName}
          workspaceName={activeWorkspaceName}
          organizationId={organizationId}
          defaultProjectId={projectId}
          defaultWorkspaceId={workspaceId}
        />
      )}
      {isExportModalOpen && workspaceData?.activeWorkspace && (
        <ExportRequestsModal
          workspace={workspaceData.activeWorkspace}
          onHide={() => setIsExportModalOpen(false)}
        />
      )}
    </Fragment>
  );
};
