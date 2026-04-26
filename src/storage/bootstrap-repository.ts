import type { Preferences, Project, ShellBootstrapData, ThreadSummary, PersonalizationSettings } from '../shared/domain';

export class BootstrapRepository {
  constructor(
    private readonly listProjects: () => Project[],
    private readonly listThreads: (projectId: string) => ThreadSummary[],
    private readonly getPreferences: () => Preferences,
    private readonly getPersonalization: () => PersonalizationSettings
  ) {}

  getBootstrapData(): ShellBootstrapData {
    const projects = this.listProjects();
    return {
      projects,
      threadsByProject: Object.fromEntries(
        projects.map((project) => [project.id, this.listThreads(project.id)])
      ),
      preferences: this.getPreferences(),
      personalization: this.getPersonalization()
    };
  }
}
