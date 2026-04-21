const repoUrl = 'https://api.github.com/repos/openai/codex';

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'vicode-upstream-check'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status} for ${url}`);
  }

  return await response.json();
}

async function main() {
  const [repo, release, commits] = await Promise.all([
    fetchJson(repoUrl),
    fetchJson(`${repoUrl}/releases/latest`).catch(() => null),
    fetchJson(`${repoUrl}/commits?per_page=1`)
  ]);

  const latestCommit = Array.isArray(commits) ? commits[0] : null;

  console.log('Codex upstream snapshot');
  console.log(`Repository: ${repo.html_url}`);
  if (release) {
    console.log(`Latest release: ${release.tag_name} (${release.published_at ?? 'unknown date'})`);
  } else {
    console.log('Latest release: unavailable');
  }
  if (latestCommit?.sha) {
    console.log(`Latest commit: ${latestCommit.sha.slice(0, 12)} (${latestCommit.commit?.committer?.date ?? 'unknown date'})`);
  } else {
    console.log('Latest commit: unavailable');
  }
  console.log('');
  console.log('Review next:');
  console.log('- codex exec and app-server contract changes');
  console.log('- tool approval, diff, and change-summary payload drift');
  console.log('- skills or integration changes worth selectively adopting');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
