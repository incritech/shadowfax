import React, { Fragment, useEffect, useState } from 'react';
import {
  Button,
  Item,
  Link,
  Menu,
  MenuTrigger,
  Popover,
  Tooltip,
  TooltipTrigger,
} from 'react-aria-components';
import {
  ActionFunction,
  LoaderFunction,
  NavLink,
  Outlet,
  redirect,
  ShouldRevalidateFunction,
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams,
  useRouteLoaderData,
} from 'react-router-dom';
import { useLocalStorage } from 'react-use';

import * as session from '../../account/session';
import {
  getAccountId,
  getCurrentSessionId,
} from '../../account/session';
import { getAppWebsiteBaseURL } from '../../common/constants';
import { database } from '../../common/database';
import { exportAllData } from '../../common/export-all-data';
import { updateLocalProjectToRemote } from '../../models/helpers/project';
import { isOwnerOfOrganization, isPersonalOrganization, isScratchpadOrganizationId, Organization } from '../../models/organization';
import { Project } from '../../models/project';
import { isDesign, isScratchpad } from '../../models/workspace';
import FileSystemDriver from '../../sync/store/drivers/file-system-driver';
import { MergeConflict } from '../../sync/types';
import { migrateProjectsIntoOrganization, shouldMigrateProjectUnderOrganization } from '../../sync/vcs/migrate-projects-into-organization';
import { getVCS, initVCS } from '../../sync/vcs/vcs';
import { invariant } from "../../utils/invariant";
import { getLoginUrl } from "../auth-session-provider";
import { Avatar } from "../components/avatar";
import { Hotkey } from "../components/hotkey";
import { Icon } from "../components/icon";
import { InsomniaAILogo } from "../components/insomnia-icon";
import { showAlert, showModal } from "../components/modals";
import { showSettingsModal } from "../components/modals/settings-modal";
import { SyncMergeModal } from "../components/modals/sync-merge-modal";
import { OrganizationAvatar } from "../components/organization-avatar";
import { PresentUsers } from "../components/present-users";
import { Toast } from "../components/toast";
import { PresenceProvider } from "../context/app/presence-context";
import { useRootLoaderData } from "./root";
import { WorkspaceLoaderData } from "./workspace";

export interface OrganizationsResponse {
  start: number;
  limit: number;
  length: number;
  total: number;
  next: string;
  organizations: Organization[];
}

interface UserProfileResponse {
  id: string;
  email: string;
  name: string;
  picture: string;
  bio: string;
  github: string;
  linkedin: string;
  twitter: string;
  identities: any;
  given_name: string;
  family_name: string;
}

type PersonalPlanType =
  | "free"
  | "individual"
  | "team"
  | "enterprise"
  | "enterprise-member";
const formatCurrentPlanType = (type: PersonalPlanType) => {
  switch (type) {
    case "free":
      return "Free";
    case "individual":
      return "Individual";
    case "team":
      return "Team";
    case "enterprise":
      return "Enterprise";
    case "enterprise-member":
      return "Enterprise Member";
    default:
      return "Free";
  }
};
type PaymentSchedules = "month" | "year";

interface CurrentPlan {
  isActive: boolean;
  period: PaymentSchedules;
  planId: string;
  price: number;
  quantity: number;
  type: PersonalPlanType;
}

export const organizationsData: OrganizationLoaderData = {
  organizations: [],
  user: undefined,
  currentPlan: undefined,
};

function sortOrganizations(
  accountId: string,
  organizations: Organization[]
): Organization[] {
  const home = organizations.find(
    (organization) =>
      isPersonalOrganization(organization) &&
      isOwnerOfOrganization({
        organization,
        accountId,
      })
  );
  const myOrgs = organizations
    .filter(
      (organization) =>
        !isPersonalOrganization(organization) &&
        isOwnerOfOrganization({
          organization,
          accountId,
        })
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const notMyOrgs = organizations
    .filter(
      (organization) =>
        !isOwnerOfOrganization({
          organization,
          accountId,
        })
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...(home ? [home] : []), ...myOrgs, ...notMyOrgs];
}

export const indexLoader: LoaderFunction = async () => {
  const sessionId = getCurrentSessionId();
  if (sessionId) {
    try {
      let vcs = getVCS();
      if (!vcs) {
        const driver = FileSystemDriver.create(
          process.env["INSOMNIA_DATA_PATH"] || window.app.getPath("userData")
        );

        console.log("Initializing VCS");
        vcs = await initVCS(driver, async (conflicts) => {
          return new Promise((resolve) => {
            showModal(SyncMergeModal, {
              conflicts,
              handleDone: (conflicts?: MergeConflict[]) =>
                resolve(conflicts || []),
            });
          });
        });
      }

      const organizationsResult =
        await window.main.insomniaFetch<OrganizationsResponse | void>({
          method: "GET",
          path: "/v1/organizations",
          sessionId,
        });

      const user = await window.main.insomniaFetch<UserProfileResponse | void>({
        method: "GET",
        path: "/v1/user/profile",
        sessionId,
      });

      const currentPlan = await window.main.insomniaFetch<CurrentPlan | void>({
        method: "GET",
        path: "/v1/billing/current-plan",
        sessionId,
      });

      invariant(organizationsResult, "Failed to load organizations");
      invariant(user, "Failed to load user");
      invariant(currentPlan, "Failed to load current plan");

      const { organizations } = organizationsResult;

      const accountId = getAccountId();
      invariant(accountId, "Account ID is not defined");
      organizationsData.organizations = sortOrganizations(
        accountId,
        organizations
      );
      organizationsData.user = user;
      organizationsData.currentPlan = currentPlan;
      const personalOrganization = organizations
        .filter(isPersonalOrganization)
        .find((organization) =>
          isOwnerOfOrganization({
            organization,
            accountId,
          })
        );
      invariant(
        personalOrganization,
        "Failed to find personal organization your account appears to be in an invalid state. Please contact support if this is a recurring issue."
      );
      if (await shouldMigrateProjectUnderOrganization()) {
        await migrateProjectsIntoOrganization({
          personalOrganization,
        });

        const preferredProjectType = localStorage.getItem(
          "prefers-project-type"
        );
        if (preferredProjectType === "remote") {
          const localProjects = await database.find<Project>("Project", {
            parentId: personalOrganization.id,
            remoteId: null,
          });

          // If any of those fail projects will still be under the organization as local projects
          for (const project of localProjects) {
            updateLocalProjectToRemote({
              project,
              organizationId: personalOrganization.id,
              sessionId,
              vcs,
            });
          }
        }
      }

      if (personalOrganization) {
        return redirect(`/organization/${personalOrganization.id}`);
      }

      if (organizations.length > 0) {
        return redirect(`/organization/${organizations[0].id}`);
      }
    } catch (error) {
      console.log("Failed to load Organizations", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      throw new Error(
        `Network connectivity issue: Failed to load Organizations. ${errorMessage}`
      );
    }
  }

  await session.logout();
  return redirect("/auth/login");
};

export const syncOrganizationsAction: ActionFunction = async () => {
  const sessionId = getCurrentSessionId();
  if (sessionId) {
    try {
      const organizationsResult =
        await window.main.insomniaFetch<OrganizationsResponse | void>({
          method: "GET",
          path: "/v1/organizations",
          sessionId,
        });

      const user = await window.main.insomniaFetch<UserProfileResponse | void>({
        method: "GET",
        path: "/v1/user/profile",
        sessionId,
      });

      const currentPlan = await window.main.insomniaFetch<CurrentPlan | void>({
        method: "GET",
        path: "/v1/billing/current-plan",
        sessionId,
      });

      invariant(organizationsResult, "Failed to load organizations");
      invariant(user, "Failed to load user");
      invariant(currentPlan, "Failed to load current plan");
      const accountId = getAccountId();
      invariant(accountId, "Account ID is not defined");
      organizationsData.organizations = sortOrganizations(
        accountId,
        organizationsResult.organizations
      );
      organizationsData.user = user;
      organizationsData.currentPlan = currentPlan;
    } catch (error) {
      console.log("Failed to load Organizations", error);
    }
  }

  return null;
};

export interface OrganizationLoaderData {
  organizations: Organization[];
  user?: UserProfileResponse;
  currentPlan?: CurrentPlan;
}

export const loader: LoaderFunction = async () => {
  if (session.isLoggedIn()) {
    return organizationsData;
  } else {
    return {
      organizations: [],
      user: undefined,
      currentPlan: undefined,
    };
  }
};

export interface FeatureStatus {
  enabled: boolean;
  reason?: string;
}

export interface FeatureList {
  gitSync: FeatureStatus;
  orgBasicRbac: FeatureStatus;
}

export const singleOrgLoader: LoaderFunction = async ({ params }) => {
  const { organizationId } = params as { organizationId: string };
  const fallbackFeatures = {
    gitSync: { enabled: false, reason: "Insomnia API unreachable" },
    orgBasicRbac: { enabled: false, reason: "Insomnia API unreachable" },
  };
  if (isScratchpadOrganizationId(organizationId)) {
    return {
      features: fallbackFeatures,
    };
  }
  try {
    const response = await window.main.insomniaFetch<
      { features: FeatureList } | undefined
    >({
      method: "GET",
      path: `/v1/organizations/${organizationId}/features`,
      sessionId: session.getCurrentSessionId(),
    });

    return {
      features: response?.features || fallbackFeatures,
    };
  } catch (err) {
    return {
      features: fallbackFeatures,
    };
  }
};

export const useOrganizationLoaderData = () => {
  return useRouteLoaderData("/organization") as OrganizationLoaderData;
};

export const shouldOrganizationsRevalidate: ShouldRevalidateFunction = ({
  currentParams,
  nextParams,
}) => {
  const isSwitchingBetweenOrganizations =
    currentParams.organizationId !== nextParams.organizationId;

  return isSwitchingBetweenOrganizations;
};

const OrganizationRoute = () => {
  const { settings, workspaceCount } = useRootLoaderData();

  const { organizations, user, currentPlan } =
    useLoaderData() as OrganizationLoaderData;
  const workspaceData = useRouteLoaderData(
    ":workspaceId"
  ) as WorkspaceLoaderData | null;
  const logoutFetcher = useFetcher();
  const navigate = useNavigate();

  const { organizationId, projectId, workspaceId } = useParams() as {
    organizationId: string;
    projectId?: string;
    workspaceId?: string;
  };
  const [status, setStatus] = useState<"online" | "offline">("online");

  useEffect(() => {
    const handleOnline = () => setStatus("online");
    const handleOffline = () => setStatus("offline");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <PresenceProvider>
      <div className="w-full h-full">
        <div className="w-full h-full divide-x divide-solid divide-y divide-[--hl-md] grid-template-app-layout grid relative bg-[--color-bg]">
          <header className="[grid-area:Header] grid grid-cols-3 items-center">
            <div className="flex items-center">
              <div className="flex w-[50px] py-2">
                <InsomniaAILogo />
              </div>
            </div>
            <div className="flex place-content-stretch gap-2 flex-nowrap items-center justify-center">
              {workspaceData && isDesign(workspaceData?.activeWorkspace) && (
                <nav className="flex rounded-full justify-between content-evenly font-semibold bg-[--hl-xs] p-[--padding-xxs]">
                  {[
                    { id: "spec", name: "spec" },
                    { name: "collection", id: "debug" },
                    { id: "test", name: "tests" },
                  ].map((item) => (
                    <NavLink
                      key={item.id}
                      to={`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/${item.id}`}
                      className={({ isActive, isPending }) =>
                        `${
                          isActive ? "text-[--color-font] bg-[--color-bg]" : ""
                        } ${
                          isPending ? "animate-pulse" : ""
                        } no-underline transition-colors text-center outline-none min-w-[4rem] uppercase text-[--color-font] text-xs px-[--padding-xs] py-[--padding-xxs] rounded-full`
                      }
                    >
                      {item.name}
                    </NavLink>
                  ))}
                </nav>
              )}
            </div>
          </header>
          <div className="[grid-area:Navbar]">
            <nav className="flex flex-col items-center place-content-stretch gap-[--padding-md] w-full h-full overflow-y-auto py-[--padding-md]">
              {organizations.map((organization) => (
                <TooltipTrigger key={organization.id}>
                  <Link>
                    <NavLink
                      className={({ isActive, isPending }) =>
                        `select-none text-[--color-font-surprise] hover:no-underline transition-all duration-150 bg-gradient-to-br box-border from-[#4000BF] to-[#154B62] font-bold outline-[3px] rounded-md w-[28px] h-[28px] flex items-center justify-center active:outline overflow-hidden outline-offset-[3px] outline ${
                          isActive
                            ? "outline-[--color-font]"
                            : "outline-transparent focus:outline-[--hl-md] hover:outline-[--hl-md]"
                        } ${isPending ? "animate-pulse" : ""}`
                      }
                      to={`/organization/${organization.id}`}
                    >
                      {isPersonalOrganization(organization) &&
                      isOwnerOfOrganization({
                        organization,
                        accountId: getAccountId() || "",
                      }) ? (
                        <Icon icon="home" />
                      ) : (
                        <OrganizationAvatar
                          alt={organization.display_name}
                          src={organization.branding?.logo_url || ""}
                        />
                      )}
                    </NavLink>
                  </Link>
                  <Tooltip
                    placement="right"
                    offset={8}
                    className="border select-none text-sm min-w-max border-solid border-[--hl-sm] shadow-lg bg-[--color-bg] text-[--color-font] px-4 py-2 rounded-md overflow-y-auto max-h-[85vh] focus:outline-none"
                  >
                    <span>{organization.display_name}</span>
                  </Tooltip>
                </TooltipTrigger>
              ))}
            </nav>
          </div>
          <Outlet />
          <div className="relative [grid-area:Statusbar] flex items-center justify-between overflow-hidden">
            <div className="flex h-full">
              <TooltipTrigger>
                <Button
                  data-testid="settings-button"
                  className="px-4 py-1 h-full flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] text-[--color-font] text-xs hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all"
                  onPress={showSettingsModal}
                >
                  <Icon icon="gear" /> Preferences
                </Button>
                <Tooltip
                  placement="top"
                  offset={8}
                  className="border flex items-center gap-2 select-none text-sm min-w-max border-solid border-[--hl-sm] shadow-lg bg-[--color-bg] text-[--color-font] px-4 py-2 rounded-md overflow-y-auto max-h-[85vh] focus:outline-none"
                >
                  Preferences
                  <Hotkey
                    keyBindings={
                      settings.hotKeyRegistry.preferences_showGeneral
                    }
                  />
                </Tooltip>
              </TooltipTrigger>
              <Button
                className="px-4 py-1 h-full flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] text-[--color-font] text-xs hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all"
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
              >
                <Icon icon="file-export" />
                Export your data {`(${workspaceCount} files)`}
              </Button>
            </div>
          </div>
        </div>
        <Toast />
      </div>
    </PresenceProvider>
  );
};

export default OrganizationRoute;
